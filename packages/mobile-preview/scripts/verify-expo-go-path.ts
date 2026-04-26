#!/usr/bin/env bun
/**
 * Post-deploy verification for the Expo Go preview path.
 *
 * Run this after merging the runtime fix + restarting the
 * mobile-preview server to confirm the manifest URL described in
 * `plans/article-native-preview-from-browser.md` line 44 actually
 * resolves end-to-end against a deployed server. Exits 0 on success,
 * 1 on any failed assertion.
 *
 * What it does (the full chain Expo Go takes when you scan a QR):
 *
 *   1. GET /status              → grab `manifestUrl` and runtime hash
 *   2. GET /manifest/<hash>     → parse multipart/mixed, extract JSON,
 *                                  pull launchAsset.url
 *   3. GET <launchAsset.url>    → fetch the bundle bytes
 *   4. eval bundle in a Hermes-shaped node:vm sandbox
 *                               → assert `_initReconciler` is defined,
 *                                  same assertion the sim's JS console
 *                                  used to fail with
 *                                  "B13 ERROR: _initReconciler not found"
 *
 * What it does NOT do: render anything visually. Hermes ≠ V8, so eval
 * succeeding here doesn't fully prove eval succeeds on iPhone Hermes.
 * Use a real device or sim for that final hop. The script's job is
 * to catch every regression that's catchable in Node before you walk
 * to the phone.
 *
 * Usage:
 *   bun run packages/mobile-preview/scripts/verify-expo-go-path.ts
 *   bun run packages/mobile-preview/scripts/verify-expo-go-path.ts http://192.168.0.14:8787
 *
 * Defaults to http://127.0.0.1:8787 (slot 0) if no URL passed.
 */
import { createContext, runInContext } from 'node:vm';

const baseUrl = process.argv[2] ?? 'http://127.0.0.1:8787';
const STEP_PREFIX = '[verify]';

function fail(msg: string): never {
    console.error(`${STEP_PREFIX} ❌ ${msg}`);
    process.exit(1);
}

function ok(msg: string): void {
    console.log(`${STEP_PREFIX} ✓ ${msg}`);
}

async function main(): Promise<void> {
    console.log(`${STEP_PREFIX} target: ${baseUrl}`);

    // Step 1: /status
    let statusBody: { runtimeHash: string | null; manifestUrl: string | null };
    try {
        const res = await fetch(`${baseUrl}/status`, { cache: 'no-store' });
        if (!res.ok) {
            fail(`/status returned HTTP ${res.status}`);
        }
        statusBody = (await res.json()) as typeof statusBody;
    } catch (err) {
        fail(
            `failed to reach ${baseUrl}/status: ${err instanceof Error ? err.message : String(err)}`,
        );
    }

    if (!statusBody.runtimeHash || !/^[0-9a-f]{64}$/.test(statusBody.runtimeHash)) {
        fail(
            `/status returned a malformed runtimeHash: ${JSON.stringify(statusBody.runtimeHash)}`,
        );
    }
    if (!statusBody.manifestUrl?.startsWith('exp://')) {
        fail(
            `/status returned a non-exp:// manifestUrl: ${JSON.stringify(statusBody.manifestUrl)}`,
        );
    }
    ok(`/status hash=${statusBody.runtimeHash.slice(0, 12)}…`);
    ok(`/status manifestUrl=${statusBody.manifestUrl}`);

    // Step 2: /manifest/:hash. Translate the exp:// URL to http:// since
    // Bun's fetch can't speak exp:// (and neither can Expo Go — iOS
    // routes the scheme to Expo Go which then issues an http:// fetch).
    const hash = statusBody.runtimeHash;
    const manifestHttpUrl = statusBody.manifestUrl.replace(
        /^exp:\/\//,
        'http://',
    );
    let manifestBody: string;
    let manifestContentType: string;
    try {
        const res = await fetch(manifestHttpUrl, {
            headers: { 'expo-platform': 'ios' },
        });
        if (!res.ok) {
            fail(`/manifest/${hash} returned HTTP ${res.status}`);
        }
        manifestContentType = res.headers.get('content-type') ?? '';
        manifestBody = await res.text();
    } catch (err) {
        fail(
            `failed to fetch ${manifestHttpUrl}: ${err instanceof Error ? err.message : String(err)}`,
        );
    }

    if (!manifestContentType.includes('multipart/mixed')) {
        fail(
            `manifest content-type is not multipart/mixed: ${JSON.stringify(manifestContentType)}`,
        );
    }
    const jsonStart = manifestBody.indexOf('{');
    const jsonEnd = manifestBody.lastIndexOf('}');
    if (jsonStart < 0 || jsonEnd <= jsonStart) {
        fail('manifest body has no embedded JSON object');
    }
    let manifest: { launchAsset: { url: string; contentType: string } };
    try {
        manifest = JSON.parse(manifestBody.slice(jsonStart, jsonEnd + 1)) as {
            launchAsset: { url: string; contentType: string };
        };
    } catch (err) {
        fail(
            `failed to parse manifest JSON: ${err instanceof Error ? err.message : String(err)}`,
        );
    }
    if (!manifest.launchAsset?.url) {
        fail(`manifest is missing launchAsset.url`);
    }
    if (!manifest.launchAsset.contentType.includes('javascript')) {
        fail(
            `launchAsset content-type isn't javascript: ${JSON.stringify(manifest.launchAsset.contentType)}`,
        );
    }
    ok(`/manifest body parsed; launchAsset.url=${manifest.launchAsset.url}`);

    // Step 3: launchAsset.url (the bundle). Translate localhost references
    // back to the user's chosen baseUrl host so this works against a
    // remote server too — the launchAsset URL is built from MOBILE_PREVIEW_LAN_IP
    // which may not match what the operator running this script can reach.
    const baseUrlObj = new URL(baseUrl);
    const launchUrl = manifest.launchAsset.url.replace(
        /^https?:\/\/[^/]+/,
        `${baseUrlObj.protocol}//${baseUrlObj.host}`,
    );
    let bundleBytes: Uint8Array;
    let bundleContentType: string;
    try {
        const res = await fetch(launchUrl);
        if (!res.ok) {
            fail(`bundle URL returned HTTP ${res.status} (${launchUrl})`);
        }
        bundleContentType = res.headers.get('content-type') ?? '';
        bundleBytes = new Uint8Array(await res.arrayBuffer());
    } catch (err) {
        fail(
            `failed to fetch bundle ${launchUrl}: ${err instanceof Error ? err.message : String(err)}`,
        );
    }
    if (!bundleContentType.includes('javascript')) {
        fail(
            `bundle content-type isn't javascript: ${JSON.stringify(bundleContentType)}`,
        );
    }
    if (bundleBytes.length < 50_000) {
        fail(
            `bundle is suspiciously small (${bundleBytes.length} bytes) — staging may have served the wrong file`,
        );
    }
    ok(`bundle fetched, ${bundleBytes.length} bytes`);

    // Step 4: eval in a Hermes-shaped sandbox. Same shape as the unit
    // tests' "Expo Go regression guard" describe block. If this fails
    // with "_initReconciler not found", the deployed server is serving
    // a buggy bundle — re-run `bun run build:runtime` and restart.
    const sandbox: Record<string, unknown> = {
        nativeFabricUIManager: { registerEventHandler: () => {} },
        nativeLoggingHook: (_msg: string, _level: number) => {},
        RN$registerCallableModule: (_name: string, _factory: () => unknown) => {},
    };
    const context = createContext(sandbox);
    try {
        runInContext(new TextDecoder().decode(bundleBytes), context, {
            filename: 'served-bundle.js',
            timeout: 5000,
        });
    } catch (err) {
        fail(
            `bundle threw during eval (Hermes/V8 mismatch is possible — verify on a real device): ${err instanceof Error ? err.message : String(err)}`,
        );
    }
    if (typeof sandbox._initReconciler !== 'function') {
        fail(
            'eval succeeded but `_initReconciler` is undefined — runtime.js was not loaded. This is the original PR #20 bug — the deployed bundle is stale. Run `bun --filter @onlook/mobile-preview dev` (which now chains build:runtime) to rebuild + restart.',
        );
    }
    if (typeof sandbox.renderApp !== 'function') {
        fail('eval succeeded but `renderApp` is undefined');
    }
    if (sandbox.React === undefined) {
        fail('eval succeeded but `React` is undefined');
    }
    ok('bundle eval: _initReconciler, renderApp, React all defined');

    console.log(
        `\n${STEP_PREFIX} ✅ All checks passed. Manifest URL is ready for Expo Go scan.\n${STEP_PREFIX}    Final hop (Hermes-on-iPhone) requires a real device or sim — this script can't cover it.\n${STEP_PREFIX}    Scan: ${statusBody.manifestUrl}`,
    );
}

main().catch((err) => {
    console.error(`${STEP_PREFIX} ❌ unexpected error:`, err);
    process.exit(1);
});

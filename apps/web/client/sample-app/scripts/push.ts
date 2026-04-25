#!/usr/bin/env bun
/**
 * Push the sample app at `apps/web/client/sample-app/App.tsx` as an
 * ABI-v1 overlay to a running cf-expo-relay. Prints the
 * `onlook://launch?session=…&relay=…` deep-link the mobile-client's
 * deeplink handler (commit `f8d70396`) routes through the URL
 * pipeline.
 *
 * Pipeline:
 *   1. esbuild bundle App.tsx → single-module CJS with externals
 *      matching the base bundle alias map (react / react-native /
 *      expo* / expo-status-bar / expo-router / etc.).
 *   2. wrapOverlayV1 wraps the CJS in the Hermes-safe ABI-v1 envelope
 *      (per `plans/adr/overlay-abi-v1.md`).
 *   3. POST { type: 'overlayUpdate', abi: 'v1', sessionId, source,
 *      assets, meta: { overlayHash, entryModule: 0, buildDurationMs } }
 *      to `<RELAY>/push/<sessionId>`.
 *
 * Usage:
 *   bun run apps/web/client/sample-app/scripts/push.ts \
 *       --relay=http://192.168.0.14:18788 \
 *       [--session=<sessionId>]      # defaults to `sample-<timestamp>`
 *       [--app=<absolute path>]      # defaults to ./App.tsx
 *
 * Environment:
 *   ONLOOK_RELAY     — same as --relay, falls back to it.
 *   ONLOOK_SESSION   — same as --session.
 *
 * The script does NOT spin up a relay — assumes one is already
 * listening. Stand one up via:
 *   cd apps/cf-expo-relay && bunx wrangler dev --port 18788 --local
 *
 * Exit codes:
 *   0 — pushed successfully (relay returned 202)
 *   1 — bundle failed
 *   2 — relay returned non-2xx
 *   3 — bad CLI args
 */
import { createHash } from 'node:crypto';
import { dirname, isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

import { wrapOverlayV1 } from '@onlook/browser-bundler';

// Externals match the base bundle's alias-map keys (the runtime resolves
// these via `OnlookRuntime.require`). Keep in sync with
// `packages/base-bundle-builder/src/runtime-capabilities.ts::REQUIRED_ALIASES`
// + `OPTIONAL_CAPABILITY_GROUPS` for the modules a sample app realistically
// imports. Adjust if the base bundle's alias map is broader.
const EXTERNALS: readonly string[] = [
    'react',
    'react/jsx-runtime',
    'react/jsx-dev-runtime',
    'react-native',
    'react-native-safe-area-context',
    'expo',
    'expo-status-bar',
    'expo-router',
    'expo-modules-core',
];

interface CliArgs {
    readonly relay: string;
    readonly sessionId: string;
    readonly appPath: string;
}

function parseArgs(argv: readonly string[]): CliArgs | { error: string } {
    let relay: string | undefined;
    let sessionId: string | undefined;
    let appPath: string | undefined;
    for (const a of argv) {
        if (a.startsWith('--relay=')) relay = a.slice('--relay='.length);
        else if (a.startsWith('--session=')) sessionId = a.slice('--session='.length);
        else if (a.startsWith('--app=')) appPath = a.slice('--app='.length);
    }
    relay = relay ?? process.env.ONLOOK_RELAY;
    sessionId = sessionId ?? process.env.ONLOOK_SESSION ?? `sample-${Date.now()}`;
    if (!relay) {
        return {
            error: 'missing --relay=<url> (or ONLOOK_RELAY env). Example: --relay=http://192.168.0.14:18788',
        };
    }
    const scriptDir = dirname(fileURLToPath(import.meta.url));
    const defaultAppPath = resolve(scriptDir, '..', 'App.tsx');
    const finalAppPath = appPath ? (isAbsolute(appPath) ? appPath : resolve(appPath)) : defaultAppPath;
    return { relay: relay.replace(/\/+$/, ''), sessionId, appPath: finalAppPath };
}

async function main(): Promise<number> {
    const args = parseArgs(process.argv.slice(2));
    if ('error' in args) {
        console.error(`[push] ${args.error}`);
        return 3;
    }
    const { relay, sessionId, appPath } = args;
    console.info(`[push] app=${appPath}`);
    console.info(`[push] relay=${relay}`);
    console.info(`[push] sessionId=${sessionId}`);

    // 1. Bundle.
    const t0 = performance.now();
    const result = await build({
        entryPoints: [appPath],
        bundle: true,
        format: 'cjs',
        platform: 'neutral',
        target: 'es2020',
        external: [...EXTERNALS],
        write: false,
        jsx: 'automatic',
        jsxDev: false,
        loader: { '.tsx': 'tsx', '.ts': 'ts' },
        logLevel: 'warning',
    });
    if (result.errors.length > 0) {
        console.error('[push] esbuild errors:', result.errors);
        return 1;
    }
    const out = result.outputFiles?.[0];
    if (!out) {
        console.error('[push] esbuild produced no output files');
        return 1;
    }
    const cjsCode = new TextDecoder().decode(out.contents);
    console.info(`[push] cjs bundle: ${cjsCode.length} bytes`);

    // 2. Wrap.
    const wrapped = wrapOverlayV1(cjsCode);
    if (wrapped.sizeWarning) console.warn(`[push] ${wrapped.sizeWarning}`);
    console.info(`[push] wrapped: ${wrapped.sizeBytes} bytes`);

    // 3. POST to relay's /push/<sessionId>.
    const overlayHash = createHash('sha256').update(wrapped.code).digest('hex');
    const buildDurationMs = Math.round(performance.now() - t0);
    const message = {
        type: 'overlayUpdate',
        abi: 'v1',
        sessionId,
        source: wrapped.code,
        assets: { abi: 'v1', assets: {} },
        meta: { overlayHash, entryModule: 0, buildDurationMs },
    };
    const pushUrl = `${relay}/push/${encodeURIComponent(sessionId)}`;
    console.info(`[push] POST ${pushUrl}`);
    const res = await fetch(pushUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(message),
    });
    const body = await res.text();
    console.info(`[push] status=${res.status} body=${body.slice(0, 200)}`);
    if (!res.ok) {
        console.error('[push] relay rejected the overlay');
        return 2;
    }

    const deepLink = `onlook://launch?session=${encodeURIComponent(sessionId)}&relay=${encodeURIComponent(relay)}`;
    console.info('[push] ✅ overlay pushed');
    console.info(`[push] deeplink: ${deepLink}`);
    console.info('[push] open the mobile-client and either scan/paste the deeplink or rely on the f8d70396 deeplink wire-up.');
    return 0;
}

main()
    .then((code) => process.exit(code))
    .catch((err) => {
        console.error('[push] unexpected error:', err);
        process.exit(1);
    });

/**
 * End-to-end integration test for the Expo Go preview path.
 *
 * Unit tests already cover each piece in isolation: `entry.js` gating
 * (`bundle-execution.test.ts` regression guard), `ensureRuntimeStaged`
 * staleness invalidation (`bundle-store.test.ts` mtime drift), and
 * manifest body shape (existing manifest.ts coverage). This test wires
 * those pieces together the way Expo Go actually consumes them — so a
 * regression in any single hop in the chain (gate, stage, serve, eval)
 * fails here even if the per-component test still passes.
 *
 * The chain we exercise, in order:
 *
 *   1. `ensureRuntimeStaged` against a temp store + the real
 *      `runtime/bundle.js`. The hash it returns is the one Expo Go
 *      would see in `/status`.
 *   2. `buildManifest` against the staged hash + fields, producing the
 *      multipart response body Expo Go fetches from `/manifest/<hash>`.
 *      We parse the JSON out and confirm the launchAsset URL points at
 *      the same hash, on the right platform path.
 *   3. `readBundle` returns the bytes that the launchAsset URL would
 *      serve. We confirm those bytes match the on-disk runtime bundle
 *      (no transformation between stage and serve).
 *   4. We evaluate the served bytes in a node:vm sandbox shaped like
 *      Expo Go's actual bridgeless+Hermes environment (no `window`, no
 *      `__noOnlookRuntime`). The contract: `_initReconciler`,
 *      `renderApp`, `React`, and `createElement` must all be present
 *      after eval — meaning shell.js's RN$AppRegistry.runApplication
 *      will successfully mount the default screen instead of logging
 *      "B13 ERROR: _initReconciler not found".
 *
 * If `runtime/bundle.js` is missing (fresh clone, failed build), the
 * suite skips with a pointer to `bun run build:runtime`.
 */
import {
    existsSync,
    mkdtempSync,
    readFileSync,
    rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createContext, runInContext } from 'node:vm';

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';

import {
    RUNTIME_BUNDLE_PATH,
    ensureRuntimeStaged,
    getBundlePath,
    readBundle,
    readManifestFields,
} from '../bundle-store';
import { buildManifest, manifestBoundary } from '../manifest';

let storeDir: string;

beforeEach(() => {
    storeDir = mkdtempSync(join(tmpdir(), 'onlook-e2e-'));
});

afterEach(() => {
    try {
        rmSync(storeDir, { recursive: true, force: true });
    } catch {
        /* ignore */
    }
});

describe('Expo Go end-to-end: stage → manifest → bundle → eval', () => {
    if (!existsSync(RUNTIME_BUNDLE_PATH)) {
        test.skip('runtime/bundle.js missing — run `bun run build:runtime` in packages/mobile-preview', () => {
            /* skipped */
        });
        return;
    }

    test('full chain produces a bundle that registers _initReconciler in an Expo-Go-shaped sandbox', () => {
        // Step 1: stage the real runtime into the temp store.
        const hash = ensureRuntimeStaged({ storeDir });
        expect(hash).toMatch(/^[0-9a-f]{64}$/);

        // Step 2: confirm the manifest fields persisted by stage are
        // readable and shape-correct (mirrors what /manifest reads).
        const fields = readManifestFields(hash, storeDir);
        expect(fields).not.toBeNull();
        expect(fields?.extra?.expoClient?.sdkVersion).toBe('54.0.0');
        expect(fields?.extra?.expoClient?.newArchEnabled).toBe(true);

        // Step 3: build the multipart manifest body against a fixed
        // host:port pair. Confirm boundary + JSON body line up.
        const manifestBody = buildManifest(hash, fields, 'ios', {
            lanIp: '127.0.0.1',
            httpPort: 8787,
        });
        const boundary = manifestBoundary(hash);
        expect(manifestBody.startsWith(`--${boundary}\r\n`)).toBe(true);
        expect(manifestBody.endsWith(`\r\n--${boundary}--\r\n`)).toBe(true);

        // Pull the JSON body out of the multipart payload and assert
        // the launchAsset URL targets the same hash on the iOS path.
        const jsonStart = manifestBody.indexOf('{');
        const jsonEnd = manifestBody.lastIndexOf('}');
        const manifestJson = JSON.parse(
            manifestBody.slice(jsonStart, jsonEnd + 1),
        ) as { launchAsset: { url: string; contentType: string } };
        expect(manifestJson.launchAsset.contentType).toBe('application/javascript');
        expect(manifestJson.launchAsset.url).toContain(`/${hash}.ts.bundle`);
        expect(manifestJson.launchAsset.url).toContain('platform=ios');

        // Step 4: confirm the bytes /:hash.bundle would serve are the
        // bytes from the on-disk runtime (no in-flight transformation).
        const servedBundle = readBundle(hash, 'ios', storeDir);
        const stagedFromDisk = readFileSync(getBundlePath(hash, 'ios', storeDir));
        expect(servedBundle.equals(stagedFromDisk)).toBe(true);
        const sourceBundle = readFileSync(RUNTIME_BUNDLE_PATH);
        expect(servedBundle.equals(sourceBundle)).toBe(true);

        // Step 5: evaluate the served bundle in a sandbox shaped exactly
        // like Expo Go SDK 54 + bridgeless + Hermes — Hermes-style
        // globals present, but `window` absent and `__noOnlookRuntime`
        // unset. Asserts shell.js's runApplication path will find
        // `_initReconciler` and render the default screen instead of
        // logging "B13 ERROR: _initReconciler not found".
        const sandbox: Record<string, unknown> = {
            nativeFabricUIManager: {
                registerEventHandler: () => {},
            },
            nativeLoggingHook: (_msg: string, _level: number) => {},
            RN$registerCallableModule: (_name: string, _factory: () => unknown) => {},
        };
        const context = createContext(sandbox);
        runInContext(servedBundle.toString('utf8'), context, {
            filename: 'served-bundle.js',
            timeout: 5000,
        });

        // The literal "Did the fix work?" assertions, in the order they
        // matter for Expo Go's mount sequence.
        expect(typeof sandbox._initReconciler).toBe('function');
        expect(typeof sandbox.renderApp).toBe('function');
        expect(typeof sandbox.createElement).toBe('function');
        expect(sandbox.React).toBeDefined();
        // shell.js's RN$AppRegistry.runApplication shadow must also
        // be present, otherwise the host's runApplication call no-ops.
        expect(typeof sandbox.RN$AppRegistry).toBe('object');
        const registry = sandbox.RN$AppRegistry as {
            runApplication?: (key: string, props: { rootTag: number }) => void;
        };
        expect(typeof registry.runApplication).toBe('function');
    });

    test('rebuilding the source bundle re-stages and serves the new hash', () => {
        // Mirrors the post-PR-#20 deploy scenario: long-running server,
        // someone rebuilds runtime/bundle.js with `bun run build:runtime`
        // (different content + new mtime), the next /status hit must
        // pick up the new hash and serve the new bytes.
        const h1 = ensureRuntimeStaged({ storeDir });
        const bundleAfterFirstStage = readBundle(h1, 'ios', storeDir);

        // Use a fake runtime path with different content + a future
        // mtime, simulating a real rebuild without actually mutating
        // the repo's runtime/bundle.js.
        const fakeDir = mkdtempSync(join(tmpdir(), 'onlook-fake-runtime-'));
        const fakePath = join(fakeDir, 'bundle.js');
        try {
            // Build a minimally-valid Expo Go bundle: shell.js + runtime.js
            // produce a different hash than the real one. We don't need
            // it to actually evaluate — we only need a different SHA256
            // and a future mtime to trigger the drift path.
            const fakeContent = `/* fake-rebuild-${Date.now()} */\n${readFileSync(RUNTIME_BUNDLE_PATH).toString('utf8')}\n/* tail */\n`;
            require('node:fs').writeFileSync(fakePath, fakeContent);
            const futureSecs = Date.now() / 1000 + 5;
            require('node:fs').utimesSync(fakePath, futureSecs, futureSecs);

            const h2 = ensureRuntimeStaged({
                runtimePath: fakePath,
                storeDir,
            });
            expect(h2).not.toBe(h1);

            const bundleAfterSecondStage = readBundle(h2, 'ios', storeDir);
            // New stage MUST serve the new content, not the cached one.
            expect(bundleAfterSecondStage.equals(bundleAfterFirstStage)).toBe(false);
            expect(bundleAfterSecondStage.toString('utf8').startsWith('/* fake-rebuild-')).toBe(true);
        } finally {
            rmSync(fakeDir, { recursive: true, force: true });
        }
    });
});

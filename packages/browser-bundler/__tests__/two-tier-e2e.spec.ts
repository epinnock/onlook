/**
 * End-to-end two-tier overlay harness — task #10 (Node mock harness).
 *
 * Composes the full pipeline against in-process mocks:
 *
 *   1. esbuild bundles a fixture App.tsx with react/react-native externalized.
 *   2. wrapOverlayV1 produces the Hermes-safe envelope.
 *   3. pushOverlayV1 POSTs the envelope to a fake-fetch relay stub.
 *   4. The stub's receive callback hands the overlay source to
 *      `installOnlookRuntimeJs().mountOverlay(source)`.
 *   5. The runtime's renderApp captures the default export; the test
 *      asserts on the captured React-like element structure.
 *
 * No Metro, no device, no real network — this E2E runs in <1s in CI and proves
 * every ABI v1 layer composes cleanly. Passes means the contract between
 * browser-bundler / mobile-client-protocol / mobile-preview/runtime is intact.
 */
import { describe, expect, test } from 'bun:test';
import esbuild from 'esbuild';
import { writeFileSync, mkdirSync } from 'node:fs';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
    OverlayUpdateMessageSchema,
    type OverlayUpdateMessage,
} from '@onlook/mobile-client-protocol';
import {
    installOnlookRuntimeJs,
    __testResetOnlookRuntime,
} from '../../mobile-preview/runtime/src/onlook-runtime-js';

import { pushOverlayV1 } from '../../../apps/web/client/src/services/expo-relay/push-overlay';
import { wrapOverlayV1 } from '../src/wrap-overlay-v1';

/**
 * Bundle a tiny CJS App with react/react-native externalized. Returns the CJS
 * source string that wrapOverlayV1 will envelope.
 */
async function bundleFixture(
    userSource: string,
    filename = 'App.tsx',
    extraExternals: readonly string[] = [],
): Promise<string> {
    const dir = mkdtempSync(join(tmpdir(), 'onlook-e2e-'));
    writeFileSync(join(dir, filename), userSource);
    const result = await esbuild.build({
        entryPoints: [join(dir, filename)],
        bundle: true,
        format: 'cjs',
        platform: 'neutral',
        target: 'es2020',
        write: false,
        external: ['react', 'react-native', ...extraExternals],
        loader: { '.ts': 'ts', '.tsx': 'tsx' },
    });
    return result.outputFiles[0]!.text;
}

/**
 * Stand up a fake relay: captures the POSTed overlayUpdate and returns a 202.
 * The captured source can be fed straight into `OnlookRuntime.mountOverlay`.
 */
function makeFakeRelay(): {
    fetch: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
    receivedOverlays: OverlayUpdateMessage[];
} {
    const receivedOverlays: OverlayUpdateMessage[] = [];
    const fetchImpl = async (
        _input: RequestInfo | URL,
        init?: RequestInit,
    ): Promise<Response> => {
        const body = init?.body;
        if (typeof body === 'string') {
            const parsed = OverlayUpdateMessageSchema.parse(JSON.parse(body));
            receivedOverlays.push(parsed);
        }
        return new Response(JSON.stringify({ delivered: 1 }), {
            status: 202,
            headers: { 'Content-Type': 'application/json' },
        });
    };
    return { fetch: fetchImpl, receivedOverlays };
}

describe('two-tier E2E — esbuild → wrap → push → relay → mountOverlay', () => {
    test('full happy-path composes every ABI v1 layer', async () => {
        __testResetOnlookRuntime();

        // 1. esbuild produces the CJS module for the user's App.
        const cjs = await bundleFixture(
            [
                "const React = require('react');",
                'function App(props) {',
                "  return React.createElement('View', { testID: 'hello' }, 'Hi ' + props.name);",
                '}',
                'module.exports = { default: App };',
            ].join('\n'),
            'App.ts',
        );

        // 2. wrapOverlayV1 envelopes the CJS for ABI v1 runtime.
        const wrapped = wrapOverlayV1(cjs);
        expect(wrapped.sizeBytes).toBeGreaterThan(0);
        expect(wrapped.code.startsWith('"use strict";')).toBe(true);

        // 3. pushOverlayV1 posts through a stubbed relay fetch.
        const relay = makeFakeRelay();
        const result = await pushOverlayV1({
            relayBaseUrl: 'https://relay-test.example.com',
            sessionId: 'e2e-sess',
            overlay: { code: wrapped.code, buildDurationMs: wrapped.sizeBytes },
            fetchImpl: relay.fetch,
            onTelemetry: null,
        });
        expect(result.ok).toBe(true);
        expect(relay.receivedOverlays).toHaveLength(1);
        const pushedOverlay = relay.receivedOverlays[0]!;
        expect(pushedOverlay.abi).toBe('v1');
        expect(pushedOverlay.sessionId).toBe('e2e-sess');
        expect(pushedOverlay.source).toBe(wrapped.code);

        // 4. On the "phone side", install the JS-fallback runtime and mount.
        const rendered: Array<{ entry: unknown; props: unknown }> = [];
        const runtime = installOnlookRuntimeJs({
            aliasMap: new Map([['react', 0]]),
            getMetroModule: (id: number) =>
                id === 0
                    ? {
                          createElement: (type: string, props: unknown, ...children: unknown[]) => ({
                              type,
                              props: { ...(props as Record<string, unknown>), children },
                          }),
                      }
                    : undefined,
            renderApp: (entry, props) => {
                rendered.push({ entry, props });
            },
        });

        runtime.mountOverlay(pushedOverlay.source, { name: 'Onlook' });

        expect(rendered).toHaveLength(1);
        const App = rendered[0]!.entry as (p: { name: string }) => unknown;
        expect(typeof App).toBe('function');
        const tree = App({ name: 'Test' }) as { type: string; props: { children: unknown[] } };
        expect(tree.type).toBe('View');
        expect(tree.props.children).toEqual(['Hi Test']);
    });

    test('ABI mismatch at the phone-side envelope surfaces before user code runs', async () => {
        __testResetOnlookRuntime();

        const cjs = 'module.exports = { default: function () { throw new Error("MUST NOT RUN"); } };';
        const wrapped = wrapOverlayV1(cjs);

        const runtime = installOnlookRuntimeJs({
            aliasMap: new Map(),
            getMetroModule: () => undefined,
            renderApp: () => {},
        });
        // Forge an ABI mismatch by replacing the `abi` field on the installed runtime
        // in-place. The envelope's guard should refuse to eval.
        (runtime as unknown as { abi: string }).abi = 'v0';
        expect(() => runtime.mountOverlay(wrapped.code, {})).toThrow(/ABI mismatch/);
    });

    test('unknown bare import in the overlay surfaces through OnlookRuntime.require', async () => {
        __testResetOnlookRuntime();

        const cjs = await bundleFixture(
            [
                "const _ = require('lodash');",
                'module.exports = { default: () => _ };',
            ].join('\n'),
            'UsesLodash.ts',
            ['lodash'],
        );
        const wrapped = wrapOverlayV1(cjs);

        const runtime = installOnlookRuntimeJs({
            aliasMap: new Map([['react', 0]]),
            getMetroModule: (_id) => ({}),
            renderApp: () => {},
        });

        expect(() => runtime.mountOverlay(wrapped.code, {})).toThrow(
            /OnlookRuntime\.require: unknown specifier "lodash"/,
        );
    });
});

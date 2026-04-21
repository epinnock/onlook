/**
 * Unit tests for the JS fallback of the Overlay ABI v1 runtime.
 *
 * Scope matches task #14 of the two-tier-overlay-v2 queue (minimal viable
 * subset): install + require + guard + reportError, plus stub assertions
 * for `mountOverlay` / `resolveAsset` / `preloadAssets`.
 */

import { beforeEach, describe, expect, it, mock } from 'bun:test';
import {
    __testResetOnlookRuntime,
    ABI_VERSION,
    installOnlookRuntimeJs,
    type OnlookRuntimeApi,
    type OnlookRuntimeError,
} from '../onlook-runtime-js.ts';

const makeReactStub = () => ({ __marker: 'react-stub' });

const buildOptions = (
    overrides: Partial<Parameters<typeof installOnlookRuntimeJs>[0]> = {},
): Parameters<typeof installOnlookRuntimeJs>[0] => {
    const aliasMap = new Map<string, number>([
        ['react', 42],
        ['react-native', 99],
    ]);
    const modules = new Map<number, unknown>([
        [42, makeReactStub()],
        [99, { __marker: 'react-native-stub' }],
    ]);
    return {
        aliasMap,
        getMetroModule: (id: number) => {
            const mod = modules.get(id);
            if (mod === undefined) {
                throw new Error(`test stub: no module for id ${id}`);
            }
            return mod;
        },
        ...overrides,
    };
};

describe('installOnlookRuntimeJs', () => {
    beforeEach(() => {
        __testResetOnlookRuntime();
    });

    it('installs globalThis.OnlookRuntime with abi === "v1" and impl === "js"', () => {
        const api = installOnlookRuntimeJs(buildOptions());

        const installed = (globalThis as { OnlookRuntime?: OnlookRuntimeApi })
            .OnlookRuntime;
        expect(installed).toBe(api);
        expect(api.abi).toBe('v1');
        expect(api.abi).toBe(ABI_VERSION);
        expect(api.impl).toBe('js');
        expect(api.lastMount).toBeUndefined();
    });

    it('guard: preserves a native runtime if one is already installed', () => {
        const nativeStub = {
            abi: 'v1' as const,
            impl: 'native' as const,
            __native: true,
            lastMount: undefined,
            require: () => {
                throw new Error('native stub');
            },
            reportError: () => {
                throw new Error('native stub');
            },
            mountOverlay: () => {
                throw new Error('native stub');
            },
            unmount: () => {
                /* native stub */
            },
            resolveAsset: () => {
                throw new Error('native stub');
            },
            preloadAssets: () => Promise.reject(new Error('native stub')),
            loadFont: () => Promise.reject(new Error('native stub')),
        } as unknown as OnlookRuntimeApi;

        (globalThis as { OnlookRuntime?: OnlookRuntimeApi }).OnlookRuntime =
            nativeStub;

        const returned = installOnlookRuntimeJs(buildOptions());

        expect(returned).toBe(nativeStub);
        const installed = (globalThis as { OnlookRuntime?: OnlookRuntimeApi })
            .OnlookRuntime;
        expect(installed).toBe(nativeStub);
        expect(installed?.impl).toBe('native');
        expect(installed?.__native).toBe(true);
    });

    it('require("react") returns the module via the alias map + getMetroModule', () => {
        const reactStub = makeReactStub();
        const aliasMap = new Map<string, number>([['react', 42]]);
        const getMetroModule = mock((id: number) => {
            expect(id).toBe(42);
            return reactStub;
        });

        const api = installOnlookRuntimeJs({ aliasMap, getMetroModule });

        const resolved = api.require('react');
        expect(resolved).toBe(reactStub);
        expect(getMetroModule).toHaveBeenCalledTimes(1);
    });

    it('require("not-in-map") throws with the expected prefix', () => {
        const api = installOnlookRuntimeJs(buildOptions());

        expect(() => api.require('not-in-map')).toThrow(
            /^OnlookRuntime\.require: unknown specifier/,
        );
    });

    it('require("not-in-map") attaches __onlookError with kind="unknown-specifier" + specifier', () => {
        const api = installOnlookRuntimeJs(buildOptions());

        let caught: unknown;
        try {
            api.require('not-in-map');
        } catch (e) {
            caught = e;
        }
        expect(caught).toBeInstanceOf(Error);
        const errorWithPayload = caught as Error & {
            __onlookError?: OnlookRuntimeError;
        };
        expect(errorWithPayload.__onlookError).toBeDefined();
        expect(errorWithPayload.__onlookError?.kind).toBe('unknown-specifier');
        expect(errorWithPayload.__onlookError?.specifier).toBe('not-in-map');
        expect(errorWithPayload.__onlookError?.message).toMatch(
            /OnlookRuntime\.require: unknown specifier "not-in-map"/,
        );
    });

    it('reportError invokes the injected onError spy exactly once with the payload', () => {
        const onError = mock((_e: OnlookRuntimeError) => {
            /* spy */
        });
        const api = installOnlookRuntimeJs(buildOptions({ onError }));

        const payload: OnlookRuntimeError = {
            kind: 'overlay-runtime',
            message: 'hi',
        };
        api.reportError(payload);

        expect(onError).toHaveBeenCalledTimes(1);
        expect(onError.mock.calls[0]?.[0]).toEqual(payload);
    });

    it('reportError with no onError handler is a silent no-op', () => {
        const api = installOnlookRuntimeJs(buildOptions());
        expect(() =>
            api.reportError({ kind: 'overlay-runtime', message: 'orphan' }),
        ).not.toThrow();
    });

    it('preloadAssets resolves to undefined when the ids list is empty', async () => {
        const api = installOnlookRuntimeJs(buildOptions());
        const result = await api.preloadAssets([]);
        expect(result).toBeUndefined();
    });

    it('preloadAssets rejects with asset-missing when any id is not in the mounted manifest', async () => {
        const api = installOnlookRuntimeJs(buildOptions());
        let caught: unknown;
        try {
            await api.preloadAssets(['missing']);
        } catch (e) {
            caught = e;
        }
        const err = caught as Error & { __onlookError?: { kind?: string } };
        expect(err?.message).toMatch(/unknown assetId/);
        expect(err?.__onlookError?.kind).toBe('asset-missing');
    });
});

// ─── mountOverlay behavioral tests (task #13) ─────────────────────────────────

describe('installOnlookRuntimeJs — mountOverlay', () => {
    beforeEach(() => {
        __testResetOnlookRuntime();
    });

    function buildOptions(
        overrides: Partial<Parameters<typeof installOnlookRuntimeJs>[0]> = {},
    ): Parameters<typeof installOnlookRuntimeJs>[0] {
        return {
            aliasMap: new Map([['react', 0]]),
            getMetroModule: (_id: number) => ({ hello: 'fake-react' }),
            ...overrides,
        };
    }

    /** Minimal wrap-overlay-v1-style envelope. */
    function envelope(userCjs: string): string {
        return [
            '"use strict";',
            '(function () {',
            '  var rt = globalThis.OnlookRuntime;',
            '  if (!rt || rt.abi !== "v1") throw new Error("abi mismatch");',
            '  rt.__pendingEntry = undefined;',
            '  var module = { exports: {} };',
            '  var exports = module.exports;',
            '  var require = function (s) { return rt.require(s); };',
            userCjs,
            '  var ex = module.exports;',
            '  rt.__pendingEntry = ex && (ex.default != null ? ex.default : ex);',
            '})();',
        ].join('\n');
    }

    it('mountOverlay evals the envelope, extracts __pendingEntry, calls renderApp', () => {
        const renderApp = mock((_entry: unknown, _props: Readonly<Record<string, unknown>>) => {});
        const api = installOnlookRuntimeJs(buildOptions({ renderApp }));
        api.mountOverlay(envelope('module.exports = { default: "ENTRY" };'), { sessionId: 'x' });

        expect(renderApp).toHaveBeenCalledTimes(1);
        const call = renderApp.mock.calls[0] ?? [];
        expect(call[0]).toBe('ENTRY');
        expect(call[1]).toEqual({ sessionId: 'x' });
    });

    it('mountOverlay caches lastMount with source + props', () => {
        const api = installOnlookRuntimeJs(buildOptions({ renderApp: () => {} }));
        const source = envelope('module.exports = { default: () => null };');
        api.mountOverlay(source, { a: 1 });
        expect(api.lastMount?.source).toBe(source);
        expect(api.lastMount?.props).toEqual({ a: 1 });
    });

    it('mountOverlay accepts and caches an asset manifest; resolveAsset returns descriptors', () => {
        const api = installOnlookRuntimeJs(buildOptions({ renderApp: () => {} }));
        const assets = {
            abi: 'v1',
            assets: { hashA: { kind: 'image', uri: 'r2://a.png' } },
        };
        api.mountOverlay(envelope('module.exports = { default: 1 };'), {}, assets);
        expect(api.resolveAsset('hashA')).toEqual({ kind: 'image', uri: 'r2://a.png' });
    });

    it('resolveAsset throws asset-missing for unknown ids', () => {
        const api = installOnlookRuntimeJs(buildOptions({ renderApp: () => {} }));
        api.mountOverlay(envelope('module.exports = { default: 1 };'), {}, { abi: 'v1', assets: {} });
        let caught: unknown;
        try {
            api.resolveAsset('missing');
        } catch (e) {
            caught = e;
        }
        const err = caught as Error & { __onlookError?: { kind?: string; assetId?: string } };
        expect(err?.message).toMatch(/unknown assetId/);
        expect(err?.__onlookError?.kind).toBe('asset-missing');
        expect(err?.__onlookError?.assetId).toBe('missing');
    });

    it('mountOverlay surfaces overlay-runtime when the envelope throws', () => {
        const onError = mock((_e: unknown) => {});
        const api = installOnlookRuntimeJs(buildOptions({ renderApp: () => {}, onError }));
        const bad = '"use strict"; (function () { throw new Error("runtime boom"); })();';
        expect(() => api.mountOverlay(bad, {})).toThrow(/runtime boom/);
        expect(onError).toHaveBeenCalledTimes(1);
        const kind = (onError.mock.calls[0]?.[0] as { kind?: string })?.kind;
        expect(kind).toBe('overlay-runtime');
    });

    it('mountOverlay surfaces overlay-parse for syntax errors', () => {
        const onError = mock((_e: unknown) => {});
        const api = installOnlookRuntimeJs(buildOptions({ renderApp: () => {}, onError }));
        const bad = '"use strict"; this is not valid js (((';
        expect(() => api.mountOverlay(bad, {})).toThrow();
        expect(onError).toHaveBeenCalledTimes(1);
        const kind = (onError.mock.calls[0]?.[0] as { kind?: string })?.kind;
        expect(kind).toBe('overlay-parse');
    });

    it('mountOverlay throws overlay-runtime when envelope forgets to publish __pendingEntry', () => {
        const api = installOnlookRuntimeJs(buildOptions({ renderApp: () => {} }));
        // No-op envelope — legal JS but does not set __pendingEntry.
        const silent = '"use strict"; (function () {})();';
        expect(() => api.mountOverlay(silent, {})).toThrow(/did not publish __pendingEntry/);
    });

    it('unmount clears lastMount + currentAssets and calls the injected unmountApp adapter', () => {
        const unmountApp = mock(() => {});
        const api = installOnlookRuntimeJs(
            buildOptions({ renderApp: () => {}, unmountApp }),
        );
        api.mountOverlay(
            envelope('module.exports = { default: 1 };'),
            {},
            { abi: 'v1', assets: { x: {} } },
        );
        api.unmount();
        expect(unmountApp).toHaveBeenCalledTimes(1);
        expect(api.lastMount).toBeUndefined();
        expect(() => api.resolveAsset('x')).toThrow(/unknown assetId/);
    });

    it('back-to-back mounts replace lastMount without leaking entries from the previous mount', () => {
        const renderApp = mock((_entry: unknown, _props: Readonly<Record<string, unknown>>) => {});
        const api = installOnlookRuntimeJs(buildOptions({ renderApp }));
        api.mountOverlay(envelope('module.exports = { default: "A" };'), {});
        api.mountOverlay(envelope('module.exports = { default: "B" };'), {});
        expect(renderApp.mock.calls).toHaveLength(2);
        expect(renderApp.mock.calls[0]?.[0]).toBe('A');
        expect(renderApp.mock.calls[1]?.[0]).toBe('B');
        expect(api.lastMount?.source).toContain('"B"');
    });

    it('bare require inside the overlay resolves through OnlookRuntime.require', () => {
        const reactStub = { createElement: () => null };
        const api = installOnlookRuntimeJs(
            buildOptions({
                aliasMap: new Map([['react', 0]]),
                getMetroModule: (id: number) => (id === 0 ? reactStub : null),
                renderApp: () => {},
            }),
        );
        api.mountOverlay(
            envelope('var r = require("react"); module.exports = { default: r };'),
            {},
        );
        expect(api.lastMount?.source).toContain('require("react")');
    });

    // ── preloadAssets + loadFont full impl (tasks #19, #20) ──────────────

    it('preloadAssets resolves when every id is present in the mounted manifest', async () => {
        const api = installOnlookRuntimeJs(buildOptions({ renderApp: () => {} }));
        api.mountOverlay(
            envelope('module.exports = { default: 1 };'),
            {},
            {
                abi: 'v1',
                assets: {
                    a: { kind: 'image', uri: 'u' },
                    b: { kind: 'image', uri: 'v' },
                },
            },
        );
        await expect(api.preloadAssets(['a', 'b'])).resolves.toBeUndefined();
    });

    it('loadFont registers a font-kind asset and resolves', async () => {
        const api = installOnlookRuntimeJs(buildOptions({ renderApp: () => {} }));
        api.mountOverlay(
            envelope('module.exports = { default: 1 };'),
            {},
            {
                abi: 'v1',
                assets: {
                    InterBold: {
                        kind: 'font',
                        family: 'Inter',
                        uri: 'r2://inter.ttf',
                    },
                },
            },
        );
        await expect(
            api.loadFont('Inter', 'InterBold', { weight: 700 }),
        ).resolves.toBeUndefined();
    });

    it('loadFont rejects when the asset ref is missing', async () => {
        const api = installOnlookRuntimeJs(buildOptions({ renderApp: () => {} }));
        api.mountOverlay(envelope('module.exports = { default: 1 };'), {}, { abi: 'v1', assets: {} });
        let caught: unknown;
        try {
            await api.loadFont('Inter', 'missing');
        } catch (e) {
            caught = e;
        }
        const err = caught as Error & { __onlookError?: { kind?: string } };
        expect(err?.__onlookError?.kind).toBe('asset-missing');
    });

    it('loadFont rejects with asset-load-failed when the ref is not kind:font', async () => {
        const api = installOnlookRuntimeJs(buildOptions({ renderApp: () => {} }));
        api.mountOverlay(
            envelope('module.exports = { default: 1 };'),
            {},
            { abi: 'v1', assets: { tree: { kind: 'image', uri: 'u' } } },
        );
        let caught: unknown;
        try {
            await api.loadFont('Inter', 'tree');
        } catch (e) {
            caught = e;
        }
        const err = caught as Error & { __onlookError?: { kind?: string } };
        expect(err?.__onlookError?.kind).toBe('asset-load-failed');
    });
});

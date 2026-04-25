/**
 * Unit test for {@link mountOverlayBundle} — the stage-4 mount helper
 * extracted from `AppRouter.tsx` so both the Overlay ABI v1 path and the
 * Spike B legacy fallback path are reachable from tests without spinning up
 * the full React tree.
 *
 * Covers the contract in `plans/adr/overlay-abi-v1.md` (ADR-0001):
 *
 *   1. When `globalThis.OnlookRuntime` is present and `abi === 'v1'`, the
 *      helper invokes `mountOverlay(source, props)` exactly once. `props`
 *      contains `sessionId`, `relayHost`, `relayPort` — and NO `rootTag`
 *      (per ADR §"Runtime globals": root tag is runtime-internal).
 *
 *   2. When `OnlookRuntime` is absent, the helper falls back to the legacy
 *      path: `(0, eval)(bundleSource)` followed by a call to
 *      `globalThis.onlookMount(props)`. Legacy props DO include `rootTag: 11`
 *      to preserve bug-for-bug compatibility with the Spike B shim.
 *
 *   3. When neither runtime path is available (no `OnlookRuntime`, no
 *      `onlookMount`), the helper returns a `failed` result with a
 *      user-visible title + message instead of throwing.
 *
 * Task: wiring the two-tier overlay ABI into the mobile client's AppRouter
 * (see `plans/adr/overlay-abi-v1.md`).
 */

import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';

// ── Mock every non-test import reached by AppRouter.tsx ──────────────────
//
// The mountOverlayBundle helper we unit-test is a pure function that only
// reads `globalThis.OnlookRuntime` / `globalThis.onlookMount`, but it is
// defined inside AppRouter.tsx alongside a heavy React / RN / screens
// import chain. Rather than extract it into a dedicated module, mock
// every top-level import the file makes so the module can load under
// bun:test without pulling in the Flow-typed `react-native` entry point
// or the native Camera / Haptics bridges.

mock.module('expo-secure-store', () => ({
    getItemAsync: async () => null,
    setItemAsync: async () => {},
    deleteItemAsync: async () => {},
}));

// Narrow RN stub — AppRouter.tsx itself only needs `View` + `StyleSheet`;
// `../screens` is mocked below so none of its RN-heavy imports run.
mock.module('react-native', () => ({
    View: () => null,
    StyleSheet: { create: (s: Record<string, unknown>) => s },
}));

// Short-circuit the heavy screen import chain — these components are never
// rendered by this unit test, and importing them would pull in
// expo-camera, expo-haptics, and the full react-native surface.
mock.module('../screens', () => ({
    CrashScreen: () => null,
    ErrorScreen: () => null,
    LauncherScreen: () => null,
    ProgressScreen: () => null,
    ScanScreen: () => null,
    ScreensGalleryScreen: () => null,
    SettingsScreen: () => null,
    VersionMismatchScreen: () => null,
}));

// Short-circuit the flow modules that AppRouter imports — the helper
// under test does not call them.
mock.module('../flow/qrToMount', () => ({
    qrToMount: async () => ({ ok: false, stage: 'parse', error: 'unused in unit test' }),
    __resetQrToMountState: () => {},
}));
mock.module('../deepLink/parse', () => ({
    parseOnlookDeepLink: () => null,
}));
mock.module('../deepLink/handler', () => ({
    useDeepLinkHandler: () => undefined,
    registerDeepLinkHandler: () => () => undefined,
}));
mock.module('../relay/manifestFetcher', () => ({
    fetchManifest: async () => ({ ok: false, error: 'unused in unit test' }),
}));
mock.module('../relay/bundleFetcher', () => ({
    fetchBundle: async () => ({ ok: false, error: 'unused in unit test' }),
}));

const { mountOverlayBundle } = await import('../navigation/AppRouter');

// ── Runtime + globalThis stubs ────────────────────────────────────────────

type MountOverlayCall = {
    source: string;
    props: Record<string, unknown> | undefined;
    assets: unknown;
};

type RuntimeStub = {
    readonly abi: 'v1';
    mountOverlay: (
        source: string,
        props?: Record<string, unknown>,
        assets?: unknown,
    ) => void;
    _mountCalls: MountOverlayCall[];
};

type OnlookMountCall = { props: Record<string, unknown> };

type GlobalWithOverlayRuntime = typeof globalThis & {
    OnlookRuntime?: RuntimeStub;
    onlookMount?: (p: Record<string, unknown>) => void;
};

function makeRuntimeStub(): RuntimeStub {
    const mountCalls: MountOverlayCall[] = [];
    return {
        abi: 'v1',
        mountOverlay: (source, props, assets) => {
            mountCalls.push({ source, props, assets });
        },
        _mountCalls: mountCalls,
    };
}

const BUNDLE_SOURCE = '(function(){ /* noop overlay */ })();';
const PARAMS = {
    sessionId: 'sess-unit-42',
    relayHost: '192.168.1.50',
    relayPort: 8788,
} as const;

let savedRuntime: RuntimeStub | undefined;
let savedOnlookMount: ((p: Record<string, unknown>) => void) | undefined;

beforeEach(() => {
    const g = globalThis as GlobalWithOverlayRuntime;
    savedRuntime = g.OnlookRuntime;
    savedOnlookMount = g.onlookMount;
    delete g.OnlookRuntime;
    delete g.onlookMount;
});

afterEach(() => {
    const g = globalThis as GlobalWithOverlayRuntime;
    if (savedRuntime === undefined) {
        delete g.OnlookRuntime;
    } else {
        g.OnlookRuntime = savedRuntime;
    }
    if (savedOnlookMount === undefined) {
        delete g.onlookMount;
    } else {
        g.onlookMount = savedOnlookMount;
    }
});

// ── Tests ─────────────────────────────────────────────────────────────────

describe('mountOverlayBundle (ABI v1 contract)', () => {
    test('invokes OnlookRuntime.mountOverlay once when abi === v1', () => {
        const runtime = makeRuntimeStub();
        (globalThis as GlobalWithOverlayRuntime).OnlookRuntime = runtime;

        const result = mountOverlayBundle(BUNDLE_SOURCE, PARAMS);

        expect(result).toEqual({ kind: 'overlay-abi-v1' });
        expect(runtime._mountCalls).toHaveLength(1);
        expect(runtime._mountCalls[0]!.source).toBe(BUNDLE_SOURCE);
        expect(runtime._mountCalls[0]!.props).toEqual({
            sessionId: PARAMS.sessionId,
            relayHost: PARAMS.relayHost,
            relayPort: PARAMS.relayPort,
        });
        // ADR §"Runtime globals": root tag is NOT exposed to overlay props.
        expect(runtime._mountCalls[0]!.props).not.toHaveProperty('rootTag');
    });

    test('falls back to eval + onlookMount when OnlookRuntime is absent', () => {
        const legacyCalls: OnlookMountCall[] = [];
        // Pre-install onlookMount so the fallback's `eval(bundleSource)` step
        // doesn't need to define it (the bundle source we pass is a no-op).
        (globalThis as GlobalWithOverlayRuntime).onlookMount = (props) => {
            legacyCalls.push({ props });
        };

        const result = mountOverlayBundle(BUNDLE_SOURCE, PARAMS);

        expect(result).toEqual({ kind: 'legacy' });
        expect(legacyCalls).toHaveLength(1);
        // Legacy path keeps `rootTag: 11` for Spike B bug-for-bug compat.
        expect(legacyCalls[0]!.props).toEqual({
            sessionId: PARAMS.sessionId,
            rootTag: 11,
            relayHost: PARAMS.relayHost,
            relayPort: PARAMS.relayPort,
        });
    });

    test('falls back to legacy when OnlookRuntime exists but abi !== v1', () => {
        const legacyCalls: OnlookMountCall[] = [];
        (globalThis as GlobalWithOverlayRuntime).onlookMount = (props) => {
            legacyCalls.push({ props });
        };
        // Runtime present but on a future ABI — helper must not call it.
        const mismatched: unknown = {
            abi: 'v2',
            mountOverlay: () => {
                throw new Error('v2 runtime should not be invoked by v1 caller');
            },
        };
        (globalThis as unknown as { OnlookRuntime: unknown }).OnlookRuntime =
            mismatched;

        const result = mountOverlayBundle(BUNDLE_SOURCE, PARAMS);

        expect(result).toEqual({ kind: 'legacy' });
        expect(legacyCalls).toHaveLength(1);
    });

    test('returns a failed result when neither runtime nor onlookMount is available', () => {
        // Bundle source that does NOT define onlookMount, and no runtime,
        // and no pre-existing onlookMount. Helper should return
        // { kind: 'failed', ... } instead of throwing.
        const result = mountOverlayBundle('var _x = 1;', PARAMS);

        expect(result.kind).toBe('failed');
        if (result.kind === 'failed') {
            expect(result.title).toBe('Mount failed');
            expect(result.message).toContain('OnlookRuntime.mountOverlay');
            expect(result.message).toContain('onlookMount');
        }
    });

    test('returns a failed result when bundle eval throws', () => {
        // Syntactically broken bundle source should produce a failed result
        // with a Bundle-eval-threw title, not an unhandled throw.
        const result = mountOverlayBundle('this is not valid javascript +++', PARAMS);

        expect(result.kind).toBe('failed');
        if (result.kind === 'failed') {
            expect(result.title).toBe('Bundle eval threw');
        }
    });
});

/**
 * Tests for the QR-to-mount end-to-end flow.
 *
 * All four pipeline dependencies are mocked with `mock.module` so the test
 * can drive each stage independently:
 *   - `../../deepLink/parse`          — parseOnlookDeepLink
 *   - `../../relay/manifestFetcher`   — fetchManifest
 *   - `../../relay/bundleFetcher`     — fetchBundle
 *   - `../../storage/recentSessions`  — addRecentSession
 *
 * The `expo-secure-store` native module is also mocked because it is a
 * transitive import of `recentSessions` and would fail to load under bun:test.
 *
 * Task: MC3.21
 * Validate: bun test apps/mobile-client/src/flow/__tests__/qrToMount.test.ts
 */

import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';

/* ── Mutable mock state ─────────────────────────────────────────────────── */

type ParsedDeepLink = {
    action: string;
    sessionId?: string;
    relay?: string;
};

type ManifestResult =
    | { ok: true; manifest: { launchAsset: { url: string } } }
    | { ok: false; error: string };

type BundleResult = { ok: true; source: string } | { ok: false; error: string };

let parseReturn: ParsedDeepLink | null = null;
let manifestReturn: ManifestResult = { ok: false, error: 'unset' };
let bundleReturn: BundleResult = { ok: false, error: 'unset' };

const parseMock = mock((_: string): ParsedDeepLink | null => parseReturn);
const fetchManifestMock = mock(
    async (_: string): Promise<ManifestResult> => manifestReturn,
);
const fetchBundleMock = mock(
    async (_: string): Promise<BundleResult> => bundleReturn,
);
const addRecentSessionMock = mock(async (_session: unknown): Promise<void> => {});

mock.module('../../deepLink/parse', () => ({
    parseOnlookDeepLink: parseMock,
}));

mock.module('../../relay/manifestFetcher', () => ({
    fetchManifest: fetchManifestMock,
}));

mock.module('../../relay/bundleFetcher', () => ({
    fetchBundle: fetchBundleMock,
}));

mock.module('../../storage/recentSessions', () => ({
    addRecentSession: addRecentSessionMock,
}));

// expo-secure-store is transitively imported by recentSessions in its barrel
// chain — mock it so bun:test doesn't try to load the native binary.
mock.module('expo-secure-store', () => ({
    getItemAsync: async () => null,
    setItemAsync: async () => {},
    deleteItemAsync: async () => {},
}));

/* ── Import under test AFTER mocks are registered ───────────────────────── */

const { qrToMount, __resetQrToMountState } = await import('../qrToMount');

/* ── Shared fixtures ────────────────────────────────────────────────────── */

const VALID_BARCODE =
    'onlook://launch?session=sess-42&relay=http://localhost:8787/manifest/abc';

const OK_PARSE: ParsedDeepLink = {
    action: 'launch',
    sessionId: 'sess-42',
    relay: 'http://localhost:8787/manifest/abc',
};

const OK_MANIFEST: ManifestResult = {
    ok: true,
    manifest: {
        launchAsset: { url: 'http://localhost:8787/bundle/abc.js' },
    },
};

const OK_BUNDLE: BundleResult = {
    ok: true,
    source: 'var hi = "hello from bundle";',
};

/* ── Per-test setup / teardown ──────────────────────────────────────────── */

type GlobalWithRuntime = typeof globalThis & {
    OnlookRuntime?: {
        runApplication?: (source: string, props: { sessionId: string }) => void;
        reloadBundle?: () => void;
    };
};

let savedRuntime: GlobalWithRuntime['OnlookRuntime'];
let logSpy: ReturnType<typeof mock>;
let warnSpy: ReturnType<typeof mock>;
let originalLog: typeof console.log;
let originalWarn: typeof console.warn;

beforeEach(() => {
    parseReturn = OK_PARSE;
    manifestReturn = OK_MANIFEST;
    bundleReturn = OK_BUNDLE;

    parseMock.mockClear();
    fetchManifestMock.mockClear();
    fetchBundleMock.mockClear();
    addRecentSessionMock.mockClear();

    // Reset the module-level "already mounted" flag so each test sees a
    // fresh first-mount condition (MCF-BUG-QR-SUBSEQUENT guard).
    __resetQrToMountState();

    savedRuntime = (globalThis as GlobalWithRuntime).OnlookRuntime;
    delete (globalThis as GlobalWithRuntime).OnlookRuntime;

    originalLog = console.log;
    originalWarn = console.warn;
    logSpy = mock(() => {});
    warnSpy = mock(() => {});
    console.log = logSpy as unknown as typeof console.log;
    console.warn = warnSpy as unknown as typeof console.warn;
});

afterEach(() => {
    (globalThis as GlobalWithRuntime).OnlookRuntime = savedRuntime;
    console.log = originalLog;
    console.warn = originalWarn;
});

/* ── Tests ──────────────────────────────────────────────────────────────── */

describe('qrToMount', () => {
    test('parse stage fails when barcode is not an Onlook URL', async () => {
        parseReturn = null;

        const result = await qrToMount('https://example.com/not-onlook');

        expect(result).toEqual({
            ok: false,
            stage: 'parse',
            error: 'Not an Onlook QR code',
        });
        // Should not have called downstream stages.
        expect(fetchManifestMock).toHaveBeenCalledTimes(0);
        expect(fetchBundleMock).toHaveBeenCalledTimes(0);
    });

    test('parse stage fails when deep link is missing sessionId or relay', async () => {
        parseReturn = { action: 'launch' };

        const result = await qrToMount('onlook://launch');

        expect(result.ok).toBe(false);
        if (!result.ok) {
            expect(result.stage).toBe('parse');
        }
        expect(fetchManifestMock).toHaveBeenCalledTimes(0);
    });

    test('manifest stage fails when relay returns an error', async () => {
        manifestReturn = { ok: false, error: 'HTTP 404: Not Found' };

        const result = await qrToMount(VALID_BARCODE);

        expect(result).toEqual({
            ok: false,
            stage: 'manifest',
            error: 'HTTP 404: Not Found',
        });
        expect(fetchManifestMock).toHaveBeenCalledTimes(1);
        expect(fetchManifestMock.mock.calls[0]?.[0]).toBe(OK_PARSE.relay);
        // Bundle must not have been attempted.
        expect(fetchBundleMock).toHaveBeenCalledTimes(0);
    });

    test('bundle stage fails when JS fetch returns an error', async () => {
        bundleReturn = { ok: false, error: 'Network error: timeout' };

        const result = await qrToMount(VALID_BARCODE);

        expect(result).toEqual({
            ok: false,
            stage: 'bundle',
            error: 'Network error: timeout',
        });
        expect(fetchBundleMock).toHaveBeenCalledTimes(1);
        expect(fetchBundleMock.mock.calls[0]?.[0]).toBe(
            OK_MANIFEST.ok ? OK_MANIFEST.manifest.launchAsset.url : '',
        );
        // addRecentSession must not have been invoked on a failed flow.
        expect(addRecentSessionMock).toHaveBeenCalledTimes(0);
    });

    test('mount stage fails when OnlookRuntime.runApplication is absent', async () => {
        // OnlookRuntime is already deleted in beforeEach.
        const result = await qrToMount(VALID_BARCODE);

        expect(result.ok).toBe(false);
        if (!result.ok) {
            expect(result.stage).toBe('mount');
            expect(result.error).toContain('MC2.7 pending');
        }
        // A log explaining the missing runtime must have been emitted.
        expect(logSpy).toHaveBeenCalled();
        // Recent session must NOT be saved when mount fails.
        expect(addRecentSessionMock).toHaveBeenCalledTimes(0);
    });

    test('mount stage fails when runApplication throws', async () => {
        const runApplication = mock(() => {
            throw new Error('JSI boom');
        });
        (globalThis as GlobalWithRuntime).OnlookRuntime = { runApplication };

        const result = await qrToMount(VALID_BARCODE);

        expect(result.ok).toBe(false);
        if (!result.ok) {
            expect(result.stage).toBe('mount');
            expect(result.error).toContain('JSI boom');
        }
        expect(runApplication).toHaveBeenCalledTimes(1);
        expect(addRecentSessionMock).toHaveBeenCalledTimes(0);
    });

    test('happy path returns ok with the parsed sessionId', async () => {
        const runApplication = mock(() => {});
        (globalThis as GlobalWithRuntime).OnlookRuntime = { runApplication };

        const result = await qrToMount(VALID_BARCODE);

        expect(result).toEqual({ ok: true, sessionId: 'sess-42' });
        expect(runApplication).toHaveBeenCalledTimes(1);
        // Bundle source + props must be forwarded verbatim.
        expect(runApplication.mock.calls[0]?.[0]).toBe(
            OK_BUNDLE.ok ? OK_BUNDLE.source : '',
        );
        expect(runApplication.mock.calls[0]?.[1]).toEqual({ sessionId: 'sess-42' });
    });

    test('happy path persists the session via addRecentSession', async () => {
        const runApplication = mock(() => {});
        (globalThis as GlobalWithRuntime).OnlookRuntime = { runApplication };

        await qrToMount(VALID_BARCODE);

        expect(addRecentSessionMock).toHaveBeenCalledTimes(1);
        const savedSession = addRecentSessionMock.mock.calls[0]?.[0] as {
            sessionId: string;
            relayHost: string;
            lastConnected: string;
        };
        expect(savedSession.sessionId).toBe('sess-42');
        expect(savedSession.relayHost).toBe(OK_PARSE.relay);
        // lastConnected should be an ISO8601 string.
        expect(() => new Date(savedSession.lastConnected).toISOString()).not.toThrow();
        expect(Number.isNaN(Date.parse(savedSession.lastConnected))).toBe(false);
    });

    test('happy path still returns ok even when addRecentSession rejects', async () => {
        const runApplication = mock(() => {});
        (globalThis as GlobalWithRuntime).OnlookRuntime = { runApplication };
        addRecentSessionMock.mockImplementationOnce(async () => {
            throw new Error('secure store offline');
        });

        const result = await qrToMount(VALID_BARCODE);

        // Mount succeeded — persistence failure is non-fatal and only warned.
        expect(result).toEqual({ ok: true, sessionId: 'sess-42' });
        expect(warnSpy).toHaveBeenCalled();
    });

    // ── Regression: MCF-BUG-QR-SUBSEQUENT ───────────────────────────────────
    //
    // Before the fix the flow always called `runApplication` for every scan.
    // The C++ binding (MC2.7) assumes a first-time mount and does not tear the
    // React tree down, so the second scan either produced a stale UI or threw
    // a bundle-eval error depending on the bundle contents — silently from the
    // user's perspective because qrToMount swallowed the failure into a
    // `stage: 'mount'` result that the UI didn't surface.
    //
    // The fix routes scan #1 through `runApplication` (first mount) and scans
    // #2+ through `reloadBundle` (MC2.8 — tears down then re-runs). Both
    // sequences return `{ ok: true }` and forward the fetched bundle source.
    test('subsequent scan routes through reloadBundle instead of runApplication', async () => {
        const runApplication = mock(() => {});
        const reloadBundle = mock(() => {});
        (globalThis as GlobalWithRuntime).OnlookRuntime = {
            runApplication,
            reloadBundle,
        };

        const first = await qrToMount(VALID_BARCODE);
        const second = await qrToMount(VALID_BARCODE);

        // Both scans must succeed end-to-end.
        expect(first).toEqual({ ok: true, sessionId: 'sess-42' });
        expect(second).toEqual({ ok: true, sessionId: 'sess-42' });

        // Scan #1 mounts via runApplication exactly once.
        expect(runApplication).toHaveBeenCalledTimes(1);
        expect(runApplication.mock.calls[0]?.[0]).toBe(
            OK_BUNDLE.ok ? OK_BUNDLE.source : '',
        );
        expect(runApplication.mock.calls[0]?.[1]).toEqual({ sessionId: 'sess-42' });

        // Scan #2 must reload the bundle, NOT re-run the application.
        expect(reloadBundle).toHaveBeenCalledTimes(1);
        expect(reloadBundle.mock.calls[0]?.[0]).toBe(
            OK_BUNDLE.ok ? OK_BUNDLE.source : '',
        );

        // Both scans persist to recents.
        expect(addRecentSessionMock).toHaveBeenCalledTimes(2);
    });

    test('reload stage surfaces error when reloadBundle throws on subsequent scan', async () => {
        const runApplication = mock(() => {});
        const reloadBundle = mock(() => {
            throw new Error('JSI teardown failed');
        });
        (globalThis as GlobalWithRuntime).OnlookRuntime = {
            runApplication,
            reloadBundle,
        };

        // First scan succeeds and arms the "already mounted" flag.
        const first = await qrToMount(VALID_BARCODE);
        expect(first.ok).toBe(true);

        // Second scan attempts reloadBundle and must surface the error on
        // the mount stage rather than silently swallowing it.
        const second = await qrToMount(VALID_BARCODE);
        expect(second.ok).toBe(false);
        if (!second.ok) {
            expect(second.stage).toBe('mount');
            expect(second.error).toContain('JSI teardown failed');
        }
        expect(runApplication).toHaveBeenCalledTimes(1);
        expect(reloadBundle).toHaveBeenCalledTimes(1);
    });
});

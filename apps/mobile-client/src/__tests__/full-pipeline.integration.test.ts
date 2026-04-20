/**
 * Full pipeline integration test (MCI.1 — in-process harness).
 *
 * This test exercises the MC3.21 QR → mount happy path end-to-end using only
 * the shipped modules from `src/relay/*` and `src/flow/qrToMount.ts`:
 *
 *   parse (MC3.3)  → manifest (MC3.11) → bundle (MC3.12) → mount (MC2.7 stub)
 *                                                          ↓
 *                               addRecentSession (MC3.8) to persist on success
 *
 * On top of the QR flow it also drives the WS path: a stubbed relay server
 * (MockWebSocket) carries `bundleUpdate` messages into `OnlookRelayClient`
 * (MC3.13) which `LiveReloadDispatcher` (MC3.14) fans out as reload events
 * wired to the stubbed `globalThis.OnlookRuntime.reloadBundle` (MC2.7 pending).
 *
 * The canonical MCI.1 entry in the queue names a Maestro YAML flow — that runs
 * against a simulator and needs the full native binary. This file is the
 * in-process equivalent: a `bun:test` harness that drives the same pipeline
 * stages without a simulator so the integration can be validated in CI ahead
 * of the native flow landing. The Maestro variant remains the canonical
 * device-level validation for Wave I exit.
 *
 * Stubs (all inline, no external test helpers):
 *   - A `MockWebSocket` drop-in that replaces `globalThis.WebSocket` — mirrors
 *     the pattern used by `src/relay/__tests__/wsClient.test.ts`.
 *   - `globalThis.fetch` is overridden per-test to route
 *     `GET /manifest/*`  → a valid Expo Updates v2 multipart/mixed manifest.
 *     `GET /bundle/*`    → a small JS bundle fixture.
 *   - `globalThis.OnlookRuntime` is set to a POJO capturing `runApplication`
 *     and `reloadBundle` calls (MC2.7 has not landed — this stands in for the
 *     JSI binding so the flow can observe the mount + reload invocations).
 *   - `expo-secure-store` is mocked via `mock.module` because it is a
 *     transitive import of `src/storage/recentSessions.ts` and would try to
 *     load the native binary under `bun:test` otherwise.
 *
 * Task: MCI.1
 * Validate: bun test apps/mobile-client/src/__tests__/full-pipeline.integration.test.ts
 *
 * NOTE: this file calls `mock.module('expo-secure-store', ...)` which is
 * process-wide in Bun and persists across test files with no auto-restore
 * hook at file boundaries. Running `bun test src` will pollute any later
 * test that imports the real `expo-secure-store` mock differently. Use
 * `bun run test` (see `scripts/run-tests-isolated.ts`), which runs each
 * test file in its own process.
 */

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, mock, test } from 'bun:test';
import type { WsMessage } from '@onlook/mobile-client-protocol';

// ── Mock expo-secure-store before any import that pulls recentSessions ─────

mock.module('expo-secure-store', () => ({
    getItemAsync: async () => null,
    setItemAsync: async () => {},
    deleteItemAsync: async () => {},
}));

// ── Imports under test (shipped modules only) ─────────────────────────────

const { qrToMount, __resetQrToMountState } = await import('../flow/qrToMount');
const { OnlookRelayClient } = await import('../relay/wsClient');
const { LiveReloadDispatcher } = await import('../relay/liveReload');

// ── MockWebSocket — in-process relay WS endpoint ──────────────────────────

type WsMessageEvent = { data: string };

/**
 * Minimal WebSocket drop-in. Mirrors the shape of `wsClient.test.ts`'s
 * `MockWebSocket`, but exposed globally so any `new WebSocket(url)` call made
 * by `OnlookRelayClient.connect()` is routed through this class.
 */
class MockWebSocket {
    static readonly CONNECTING = 0;
    static readonly OPEN = 1;
    static readonly CLOSING = 2;
    static readonly CLOSED = 3;

    static instances: MockWebSocket[] = [];

    readonly url: string;
    readyState: number = MockWebSocket.CONNECTING;

    onopen: (() => void) | null = null;
    onmessage: ((event: WsMessageEvent) => void) | null = null;
    onclose: (() => void) | null = null;
    onerror: (() => void) | null = null;

    sentMessages: string[] = [];

    constructor(url: string) {
        this.url = url;
        MockWebSocket.instances.push(this);
    }

    send(data: string): void {
        this.sentMessages.push(data);
    }

    close(): void {
        this.readyState = MockWebSocket.CLOSED;
        this.onclose?.();
    }

    // ── Test helpers driven by the harness ────────────────────────────────

    simulateOpen(): void {
        this.readyState = MockWebSocket.OPEN;
        this.onopen?.();
    }

    simulateMessage(msg: WsMessage): void {
        this.onmessage?.({ data: JSON.stringify(msg) });
    }

    simulateClose(): void {
        this.readyState = MockWebSocket.CLOSED;
        this.onclose?.();
    }
}

// ── Fetch stub — serves manifest + bundle from the fake relay ─────────────

const RELAY_BASE = 'http://localhost:8787';
const MANIFEST_URL = `${RELAY_BASE}/manifest/abc123`;
const BUNDLE_URL = `${RELAY_BASE}/bundle/abc123.js`;
const WS_URL = `${RELAY_BASE.replace('http', 'ws')}/ws`;
const SESSION_ID = 'sess-mci1-42';

const BUNDLE_SOURCE =
    '(function(){var __DEV__=false;console.log("onlook mci1 bundle");})();';

const RELOADED_BUNDLE_URL = `${RELAY_BASE}/bundle/def456.js`;

const BOUNDARY = 'formdata-onlook-mci1';

const VALID_MANIFEST = {
    id: 'c6a1fbc0-3d4e-4f12-b456-7890abcdef01',
    createdAt: '2026-04-11T00:00:00.000Z',
    runtimeVersion: '54.0.0',
    launchAsset: {
        hash: 'a3f8deadbeef',
        key: 'bundle',
        contentType: 'application/javascript',
        url: BUNDLE_URL,
    },
    assets: [],
    extra: {
        expoClient: {
            onlookRuntimeVersion: '0.1.0',
            protocolVersion: 1,
            scheme: 'onlook',
        },
    },
};

function multipartManifest(): Response {
    const json = JSON.stringify(VALID_MANIFEST);
    const body =
        `--${BOUNDARY}\r\n` +
        `Content-Disposition: form-data; name="manifest"\r\n` +
        `Content-Type: application/json\r\n` +
        `\r\n` +
        `${json}\r\n` +
        `--${BOUNDARY}--\r\n`;
    return new Response(body, {
        status: 200,
        statusText: 'OK',
        headers: {
            'Content-Type': `multipart/mixed; boundary=${BOUNDARY}`,
            'Cache-Control': 'private, max-age=0',
            'expo-protocol-version': '0',
            'expo-sfv-version': '0',
        },
    });
}

function jsBundle(source: string): Response {
    return new Response(source, {
        status: 200,
        statusText: 'OK',
        headers: { 'Content-Type': 'application/javascript' },
    });
}

/**
 * Route a fetch URL through the fake relay. Unknown paths return 404 so the
 * test fails loudly instead of silently accepting wrong URLs.
 */
function fakeRelayFetch(
    input: RequestInfo | URL,
    _init?: RequestInit,
): Promise<Response> {
    const url = typeof input === 'string' ? input : input.toString();
    if (url === MANIFEST_URL) {
        return Promise.resolve(multipartManifest());
    }
    if (url === BUNDLE_URL || url === RELOADED_BUNDLE_URL) {
        return Promise.resolve(jsBundle(BUNDLE_SOURCE));
    }
    return Promise.resolve(
        new Response(`unexpected fetch: ${url}`, {
            status: 404,
            statusText: 'Not Found',
        }),
    );
}

// ── OnlookRuntime stub (MC2.7 pending) ────────────────────────────────────

type OnlookRuntimeStub = {
    runApplication: (source: string, props: { sessionId: string }) => void;
    reloadBundle: (bundleUrl: string) => void;
    _runCalls: Array<{ source: string; props: { sessionId: string } }>;
    _reloadCalls: string[];
};

type GlobalWithRuntime = typeof globalThis & {
    OnlookRuntime?: OnlookRuntimeStub;
    WebSocket: typeof WebSocket;
    fetch: typeof fetch;
};

function makeRuntimeStub(): OnlookRuntimeStub {
    const runCalls: Array<{ source: string; props: { sessionId: string } }> = [];
    const reloadCalls: string[] = [];
    return {
        runApplication: (source, props) => {
            runCalls.push({ source, props });
        },
        reloadBundle: (bundleUrl) => {
            reloadCalls.push(bundleUrl);
        },
        _runCalls: runCalls,
        _reloadCalls: reloadCalls,
    };
}

// ── Setup / teardown ──────────────────────────────────────────────────────

const ORIGINAL_WEBSOCKET = (globalThis as GlobalWithRuntime).WebSocket;
const ORIGINAL_FETCH = (globalThis as GlobalWithRuntime).fetch;

let savedRuntime: OnlookRuntimeStub | undefined;

beforeAll(() => {
    // Route all WS construction through MockWebSocket for the whole suite.
    (globalThis as unknown as { WebSocket: typeof WebSocket }).WebSocket =
        MockWebSocket as unknown as typeof WebSocket;
});

afterAll(() => {
    (globalThis as unknown as { WebSocket: typeof WebSocket }).WebSocket =
        ORIGINAL_WEBSOCKET;
});

beforeEach(() => {
    MockWebSocket.instances = [];
    // Fresh fetch stub each test.
    (globalThis as GlobalWithRuntime).fetch = fakeRelayFetch as typeof fetch;
    // Fresh OnlookRuntime stub per test so call counts don't leak.
    savedRuntime = (globalThis as GlobalWithRuntime).OnlookRuntime;
    (globalThis as GlobalWithRuntime).OnlookRuntime = makeRuntimeStub();
    // Reset the qrToMount "already mounted" flag so each test starts in the
    // fresh-first-mount state (MCF-BUG-QR-SUBSEQUENT guard).
    __resetQrToMountState();
});

afterEach(() => {
    (globalThis as GlobalWithRuntime).fetch = ORIGINAL_FETCH;
    if (savedRuntime === undefined) {
        delete (globalThis as GlobalWithRuntime).OnlookRuntime;
    } else {
        (globalThis as GlobalWithRuntime).OnlookRuntime = savedRuntime;
    }
});

// ── Tests ─────────────────────────────────────────────────────────────────

describe('full pipeline integration (MCI.1)', () => {
    test('QR → manifest → bundle → runApplication happy path drives all four stages', async () => {
        const barcode = `onlook://launch?session=${SESSION_ID}&relay=${encodeURIComponent(
            MANIFEST_URL,
        )}`;

        const result = await qrToMount(barcode);

        // Parse + manifest + bundle + mount must all have succeeded.
        expect(result).toEqual({ ok: true, sessionId: SESSION_ID });

        // The runApplication JSI stub must have received the exact bundle bytes
        // fetched from the fake relay plus the parsed sessionId as props.
        const runtime = (globalThis as GlobalWithRuntime).OnlookRuntime!;
        expect(runtime._runCalls).toHaveLength(1);
        expect(runtime._runCalls[0]!.source).toBe(BUNDLE_SOURCE);
        expect(runtime._runCalls[0]!.props).toEqual({ sessionId: SESSION_ID });
    });

    test('connect → bundleUpdate → reloadBundle → disconnect reload cycle', async () => {
        // First mount, to establish a session and prove the pipeline is hot.
        const barcode = `onlook://launch?session=${SESSION_ID}&relay=${encodeURIComponent(
            MANIFEST_URL,
        )}`;
        const mountResult = await qrToMount(barcode);
        expect(mountResult.ok).toBe(true);

        const runtime = (globalThis as GlobalWithRuntime).OnlookRuntime!;

        // Now wire the WS client + live-reload dispatcher the same way the
        // app would after a successful mount (MC3.21 app wiring).
        const relay = new OnlookRelayClient(WS_URL, { autoReconnect: false });
        const dispatcher = new LiveReloadDispatcher(relay);
        dispatcher.onReload((bundleUrl) => {
            // This is the same call the app-level wiring makes post-MC3.21.
            runtime.reloadBundle(bundleUrl);
        });
        dispatcher.start();

        relay.connect();

        // Exactly one WS should have been opened by connect().
        expect(MockWebSocket.instances).toHaveLength(1);
        const ws = MockWebSocket.instances[0]!;
        expect(ws.url).toBe(WS_URL);

        // Open the connection — the dispatcher starts listening once relay
        // goes OPEN (listeners already registered via start()).
        ws.simulateOpen();
        expect(relay.isConnected).toBe(true);

        // Push a bundleUpdate through the WS endpoint. This exercises:
        //   MockWebSocket → OnlookRelayClient → LiveReloadDispatcher → runtime.reloadBundle
        const bundleUpdate: WsMessage = {
            type: 'bundleUpdate',
            sessionId: SESSION_ID,
            bundleUrl: RELOADED_BUNDLE_URL,
            onlookRuntimeVersion: '0.1.0',
            timestamp: Date.now(),
        };
        ws.simulateMessage(bundleUpdate);

        expect(runtime._reloadCalls).toEqual([RELOADED_BUNDLE_URL]);

        // Non-bundle messages must NOT trigger reloadBundle.
        const consoleMsg: WsMessage = {
            type: 'onlook:console',
            sessionId: SESSION_ID,
            level: 'log',
            args: ['hello'],
            timestamp: Date.now(),
        };
        ws.simulateMessage(consoleMsg);
        expect(runtime._reloadCalls).toHaveLength(1);

        // Second bundle update should accumulate.
        const secondUpdate: WsMessage = {
            ...bundleUpdate,
            bundleUrl: `${RELAY_BASE}/bundle/ghi789.js`,
            timestamp: Date.now() + 1,
        };
        ws.simulateMessage(secondUpdate);
        expect(runtime._reloadCalls).toEqual([
            RELOADED_BUNDLE_URL,
            `${RELAY_BASE}/bundle/ghi789.js`,
        ]);

        // Disconnect — must close the underlying socket and prevent reconnect.
        relay.disconnect();
        dispatcher.stop();

        expect(relay.isConnected).toBe(false);
        expect(ws.readyState).toBe(MockWebSocket.CLOSED);
        // No additional sockets should have been created after disconnect.
        expect(MockWebSocket.instances).toHaveLength(1);
    });

    test('mount stage surfaces MC2.7-pending error when OnlookRuntime is absent', async () => {
        // Simulate the pre-MC2.7 state: no JSI binding installed.
        delete (globalThis as GlobalWithRuntime).OnlookRuntime;

        const originalLog = console.log;
        const logSpy = mock(() => {});
        console.log = logSpy as unknown as typeof console.log;

        try {
            const barcode = `onlook://launch?session=${SESSION_ID}&relay=${encodeURIComponent(
                MANIFEST_URL,
            )}`;
            const result = await qrToMount(barcode);

            expect(result.ok).toBe(false);
            if (!result.ok) {
                expect(result.stage).toBe('mount');
                expect(result.error).toContain('MC2.7 pending');
            }
            // The flow logs a diagnostic when the runtime is missing.
            expect(logSpy).toHaveBeenCalled();
        } finally {
            console.log = originalLog;
        }
    });

    test('manifest stage failure short-circuits before bundle or mount', async () => {
        // Route the manifest URL to a 500 to force a manifest-stage failure.
        (globalThis as GlobalWithRuntime).fetch = ((
            input: RequestInfo | URL,
            init?: RequestInit,
        ) => {
            const url = typeof input === 'string' ? input : input.toString();
            if (url === MANIFEST_URL) {
                return Promise.resolve(
                    new Response('boom', { status: 500, statusText: 'Server Error' }),
                );
            }
            return fakeRelayFetch(input, init);
        }) as typeof fetch;

        const barcode = `onlook://launch?session=${SESSION_ID}&relay=${encodeURIComponent(
            MANIFEST_URL,
        )}`;
        const result = await qrToMount(barcode);

        expect(result.ok).toBe(false);
        if (!result.ok) {
            expect(result.stage).toBe('manifest');
            expect(result.error).toContain('500');
        }

        const runtime = (globalThis as GlobalWithRuntime).OnlookRuntime!;
        // runApplication must not have been invoked on a failed flow.
        expect(runtime._runCalls).toHaveLength(0);
    });
});

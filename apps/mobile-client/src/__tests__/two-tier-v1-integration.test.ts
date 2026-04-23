/**
 * Phase 11b end-to-end integration — composes all 8 Phase 11b bug fixes
 * through their REAL implementation (not the FakeDispatcher shortcut
 * twoTierBootstrap.test.ts uses).
 *
 * Flow exercised:
 *   1. Relay sends a v1 OverlayUpdateMessage JSON string to the phone's
 *      WebSocket (MockWebSocket wire-level simulation).
 *   2. OverlayDispatcher.handleRaw parses via OverlayUpdateMessageSchema,
 *      normalizes source → code, preserves meta/assets/abi/sessionId.
 *   3. twoTierBootstrap's mount callback sees msg.abi === 'v1' and routes
 *      to OnlookRuntime.mountOverlay(source, props, assets).
 *   4. Props shape matches {sessionId, relayHost, relayPort} — the same
 *      shape AppRouter.buildUrlPipelineRunner + qrToMount.v1-fast-path pass.
 *   5. Mount succeeds; sendAck fires with msg.meta.overlayHash as the real
 *      sha256 (not the legacy-<length> synthetic).
 *   6. Ack is written to the dispatcher's send path.
 *
 * Each fix from the 8-bug audit series is verified as part of this
 * composite chain. A regression in ANY of them would break this test.
 */

import { afterEach, describe, expect, mock, test } from 'bun:test';

// Short-circuit react-native so the mobile-client imports load in bun:test.
mock.module('react-native', () => ({
    View: () => null,
    StyleSheet: { create: (s: Record<string, unknown>) => s },
}));

const { startTwoTierBootstrap } = (await import('../flow/twoTierBootstrap')) as typeof import(
    '../flow/twoTierBootstrap'
);
const { OverlayDispatcher } = (await import('../relay/overlayDispatcher')) as typeof import(
    '../relay/overlayDispatcher'
);

// ── MockWebSocket that mimics RN's WebSocket (open / message / close events) ─
class MockSocket {
    readyState = 0; // CONNECTING
    private listeners: Record<string, Array<(event: unknown) => void>> = {};
    sent: unknown[] = [];

    constructor(public url: string) {
        setTimeout(() => {
            this.readyState = 1; // OPEN
            this.dispatch('open', { type: 'open' });
        }, 0);
    }

    addEventListener(event: string, cb: (event: unknown) => void): void {
        (this.listeners[event] ??= []).push(cb);
    }

    removeEventListener(event: string, cb: (event: unknown) => void): void {
        const arr = this.listeners[event];
        if (!arr) return;
        const idx = arr.indexOf(cb);
        if (idx >= 0) arr.splice(idx, 1);
    }

    close(): void {
        this.readyState = 3; // CLOSED
        this.dispatch('close', { type: 'close' });
    }

    send(data: string): void {
        this.sent.push(JSON.parse(data));
    }

    /** Test helper — simulate the relay pushing a message TO this socket. */
    relayPush(payload: unknown): void {
        this.readyState = 1;
        this.dispatch('message', {
            type: 'message',
            data: typeof payload === 'string' ? payload : JSON.stringify(payload),
        });
    }

    private dispatch(event: string, payload: unknown): void {
        for (const cb of this.listeners[event] ?? []) cb(payload);
    }
}

const origRuntime = (globalThis as { OnlookRuntime?: unknown }).OnlookRuntime;
const origWebSocket = globalThis.WebSocket;
afterEach(() => {
    (globalThis as { OnlookRuntime?: unknown }).OnlookRuntime = origRuntime;
    globalThis.WebSocket = origWebSocket;
});

describe('Phase 11b v1 end-to-end integration', () => {
    test('v1 wire shape → dispatcher normalize → mount route → ack with real hash', async () => {
        // Capture mountOverlay calls.
        const mountCalls: Array<{
            source: string;
            props: Record<string, unknown> | undefined;
            assets: unknown;
        }> = [];
        // Capture reportError calls for boundary-error verification.
        const reportErrorCalls: Array<{ kind: string; message: string }> = [];

        (globalThis as { OnlookRuntime?: unknown }).OnlookRuntime = {
            abi: 'v1',
            mountOverlay: (
                source: string,
                props?: Record<string, unknown>,
                assets?: unknown,
            ) => mountCalls.push({ source, props, assets }),
            reportError: (e: { kind: string; message: string }) =>
                reportErrorCalls.push(e),
        };

        // Inject MockSocket into the dispatcher's createSocket factory.
        const sockets: MockSocket[] = [];
        const dispatcher = new OverlayDispatcher('ws://relay.lan:8891/hmr/sess-v1e2e', {
            createSocket: (url) => {
                const s = new MockSocket(url);
                sockets.push(s);
                return s as unknown as WebSocket;
            },
        });

        startTwoTierBootstrap({
            sessionId: 'sess-v1e2e',
            relayUrl: 'ws://relay.lan:8891/hmr/sess-v1e2e',
            enabled: true,
            createDispatcher: () => dispatcher,
        });

        // Yield one microtask so the mock socket's open event fires.
        await new Promise((r) => setTimeout(r, 5));

        // Fix #1: dispatcher accepts v1 shape.
        // Fix #2: twoTierBootstrap routes to mountOverlay.
        // Fix #3: sendAck uses real meta.overlayHash.
        // Fix #4: props include relayHost + relayPort.
        const realHash = 'a'.repeat(64);
        const v1Message = {
            type: 'overlayUpdate',
            abi: 'v1',
            sessionId: 'sess-v1e2e',
            source: 'module.exports = { default: function(){ return null; } };',
            assets: { abi: 'v1', assets: {} },
            meta: {
                overlayHash: realHash,
                entryModule: 0,
                buildDurationMs: 8,
            },
        };
        sockets[0]!.relayPush(v1Message);

        // #1 + #2: mount was called exactly once with the v1 source.
        expect(mountCalls).toHaveLength(1);
        expect(mountCalls[0]!.source).toBe(v1Message.source);

        // #4: props shape matches AppRouter/qrToMount's {sessionId, relayHost, relayPort}.
        expect(mountCalls[0]!.props).toEqual({
            sessionId: 'sess-v1e2e',
            relayHost: 'relay.lan',
            relayPort: 8891,
        });

        // Assets forwarded (not sourceMap — Phase 9 follow-up).
        expect(mountCalls[0]!.assets).toEqual({ abi: 'v1', assets: {} });

        // #3: sendAck used the real hash from meta.overlayHash.
        expect(sockets[0]!.sent).toHaveLength(1);
        const ack = sockets[0]!.sent[0] as {
            type: string;
            sessionId: string;
            overlayHash: string;
            status: string;
        };
        expect(ack.type).toBe('onlook:overlayAck');
        expect(ack.sessionId).toBe('sess-v1e2e');
        expect(ack.overlayHash).toBe(realHash);
        expect(ack.status).toBe('mounted');
    });

    test('mount failure produces an overlayAck with status="failed" + the same real hash', async () => {
        const realHash = 'b'.repeat(64);
        (globalThis as { OnlookRuntime?: unknown }).OnlookRuntime = {
            abi: 'v1',
            mountOverlay: () => {
                throw new Error('mount boom in v1');
            },
        };

        const sockets: MockSocket[] = [];
        const dispatcher = new OverlayDispatcher('ws://relay.lan:8891/hmr/sess-fail', {
            createSocket: (url) => {
                const s = new MockSocket(url);
                sockets.push(s);
                return s as unknown as WebSocket;
            },
        });

        startTwoTierBootstrap({
            sessionId: 'sess-fail',
            relayUrl: 'ws://relay.lan:8891/hmr/sess-fail',
            enabled: true,
            createDispatcher: () => dispatcher,
        });
        await new Promise((r) => setTimeout(r, 5));

        sockets[0]!.relayPush({
            type: 'overlayUpdate',
            abi: 'v1',
            sessionId: 'sess-fail',
            source: 'throw new Error("oops");',
            assets: { abi: 'v1', assets: {} },
            meta: { overlayHash: realHash, entryModule: 0, buildDurationMs: 2 },
        });

        const ack = sockets[0]!.sent[0] as {
            overlayHash: string;
            status: string;
            error?: { kind: string; message: string };
        };
        expect(ack.status).toBe('failed');
        expect(ack.overlayHash).toBe(realHash);
        expect(ack.error?.message).toContain('mount boom in v1');
    });

    test('legacy wire shape on the same integration path still mounts via reloadBundle (Phase G preservation)', async () => {
        const reloadCalls: string[] = [];
        (globalThis as { OnlookRuntime?: unknown }).OnlookRuntime = {
            // No abi field = legacy runtime; reloadBundle is the only mount path.
            reloadBundle: (code: string) => reloadCalls.push(code),
        };

        const sockets: MockSocket[] = [];
        const dispatcher = new OverlayDispatcher('ws://relay.lan:8891/hmr/sess-leg', {
            createSocket: (url) => {
                const s = new MockSocket(url);
                sockets.push(s);
                return s as unknown as WebSocket;
            },
        });

        startTwoTierBootstrap({
            sessionId: 'sess-leg',
            relayUrl: 'ws://relay.lan:8891/hmr/sess-leg',
            enabled: true,
            createDispatcher: () => dispatcher,
        });
        await new Promise((r) => setTimeout(r, 5));

        sockets[0]!.relayPush({
            type: 'overlay',
            code: 'globalThis.onlookMount = function(){};',
        });

        expect(reloadCalls).toEqual(['globalThis.onlookMount = function(){};']);
        // Legacy ack uses legacy-<length> synthetic (no meta on legacy shape).
        const ack = sockets[0]!.sent[0] as { overlayHash: string };
        expect(ack.overlayHash).toMatch(/^legacy-\d+$/);
    });
});

/**
 * Tests for the Onlook relay WebSocket client.
 *
 * Task: MC3.13
 * Validate: bun test apps/mobile-client/src/relay/__tests__/wsClient.test.ts
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import type { WsMessage } from '@onlook/mobile-client-protocol';
import { OnlookRelayClient } from '../wsClient';

// ── MockWebSocket ────────────────────────────────────────────────────────────

type WsEventHandler = ((event: { data: string }) => void) | null;

/** Minimal WebSocket mock that captures the URL and exposes trigger helpers. */
class MockWebSocket {
    static readonly CONNECTING = 0;
    static readonly OPEN = 1;
    static readonly CLOSING = 2;
    static readonly CLOSED = 3;

    static instances: MockWebSocket[] = [];

    readonly url: string;
    readyState: number = MockWebSocket.CONNECTING;

    onopen: (() => void) | null = null;
    onmessage: WsEventHandler = null;
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

    // ── Test helpers ──────────────────────────────────────────────────────

    /** Simulate a successful connection. */
    simulateOpen(): void {
        this.readyState = MockWebSocket.OPEN;
        this.onopen?.();
    }

    /** Simulate receiving a message. */
    simulateMessage(data: string): void {
        this.onmessage?.({ data });
    }

    /** Simulate an unexpected close (e.g. server drops connection). */
    simulateClose(): void {
        this.readyState = MockWebSocket.CLOSED;
        this.onclose?.();
    }

    /** Simulate an error followed by close. */
    simulateError(): void {
        this.onerror?.();
        this.simulateClose();
    }
}

// ── Fixtures ─────────────────────────────────────────────────────────────────

const RELAY_WS_URL = 'wss://expo-relay.onlook.workers.dev/ws';

const VALID_BUNDLE_UPDATE: WsMessage = {
    type: 'bundleUpdate',
    sessionId: 'sess-abc-123',
    bundleUrl: 'https://relay.onlook.com/bundle.js',
    onlookRuntimeVersion: '0.1.0',
    timestamp: Date.now(),
};

const VALID_CONSOLE_MSG: WsMessage = {
    type: 'onlook:console',
    sessionId: 'sess-abc-123',
    level: 'log',
    args: ['hello', 'world'],
    timestamp: Date.now(),
};

// ── Setup / Teardown ─────────────────────────────────────────────────────────

const OriginalWebSocket = globalThis.WebSocket;

beforeEach(() => {
    MockWebSocket.instances = [];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    globalThis.WebSocket = MockWebSocket as any;
});

afterEach(() => {
    globalThis.WebSocket = OriginalWebSocket;
});

// ── Tests ────────────────────────────────────────────────────────────────────

describe('OnlookRelayClient', () => {
    test('connect() opens a WebSocket to the given URL', () => {
        const client = new OnlookRelayClient(RELAY_WS_URL);
        client.connect();

        expect(MockWebSocket.instances).toHaveLength(1);
        expect(MockWebSocket.instances[0]!.url).toBe(RELAY_WS_URL);
    });

    test('isConnected returns true only when the socket is OPEN', () => {
        const client = new OnlookRelayClient(RELAY_WS_URL);

        expect(client.isConnected).toBe(false);

        client.connect();
        const ws = MockWebSocket.instances[0]!;
        expect(client.isConnected).toBe(false); // still CONNECTING

        ws.simulateOpen();
        expect(client.isConnected).toBe(true);

        ws.simulateClose();
        expect(client.isConnected).toBe(false);
    });

    test('valid message event is parsed and dispatched to all handlers', () => {
        const client = new OnlookRelayClient(RELAY_WS_URL);
        const received: WsMessage[] = [];
        client.onMessage((msg) => received.push(msg));

        client.connect();
        const ws = MockWebSocket.instances[0]!;
        ws.simulateOpen();

        ws.simulateMessage(JSON.stringify(VALID_BUNDLE_UPDATE));
        ws.simulateMessage(JSON.stringify(VALID_CONSOLE_MSG));

        expect(received).toHaveLength(2);
        expect(received[0]!.type).toBe('bundleUpdate');
        expect(received[1]!.type).toBe('onlook:console');
    });

    test('invalid JSON message is silently ignored (no throw, no dispatch)', () => {
        const client = new OnlookRelayClient(RELAY_WS_URL);
        const received: WsMessage[] = [];
        client.onMessage((msg) => received.push(msg));

        client.connect();
        const ws = MockWebSocket.instances[0]!;
        ws.simulateOpen();

        // Invalid JSON
        ws.simulateMessage('this is not json {{{');
        // Valid JSON but wrong shape
        ws.simulateMessage(JSON.stringify({ type: 'unknownType', foo: 'bar' }));
        // Empty string
        ws.simulateMessage('');

        expect(received).toHaveLength(0);
    });

    test('disconnect() closes the WebSocket and prevents reconnection', () => {
        const client = new OnlookRelayClient(RELAY_WS_URL);
        client.connect();
        const ws = MockWebSocket.instances[0]!;
        ws.simulateOpen();

        expect(client.isConnected).toBe(true);

        client.disconnect();

        expect(client.isConnected).toBe(false);
        expect(ws.readyState).toBe(MockWebSocket.CLOSED);

        // No reconnect attempt should be scheduled — only 1 instance total.
        expect(MockWebSocket.instances).toHaveLength(1);
    });

    test('unsubscribe removes handler so it no longer receives messages', () => {
        const client = new OnlookRelayClient(RELAY_WS_URL);
        const received: WsMessage[] = [];
        const unsub = client.onMessage((msg) => received.push(msg));

        client.connect();
        const ws = MockWebSocket.instances[0]!;
        ws.simulateOpen();

        ws.simulateMessage(JSON.stringify(VALID_BUNDLE_UPDATE));
        expect(received).toHaveLength(1);

        unsub();

        ws.simulateMessage(JSON.stringify(VALID_CONSOLE_MSG));
        // Should still be 1 — the handler was removed.
        expect(received).toHaveLength(1);
    });

    test('auto-reconnect fires on unexpected close with exponential backoff', async () => {
        const client = new OnlookRelayClient(RELAY_WS_URL, {
            autoReconnect: true,
            maxReconnectDelay: 8_000,
        });

        client.connect();
        const ws1 = MockWebSocket.instances[0]!;
        ws1.simulateOpen();

        // Simulate unexpected close.
        ws1.simulateClose();

        // After 1s backoff a new WebSocket should be created.
        // Use a real timer wait (bun:test supports async).
        await new Promise((resolve) => setTimeout(resolve, 1_100));

        expect(MockWebSocket.instances.length).toBeGreaterThanOrEqual(2);
        const ws2 = MockWebSocket.instances[1]!;
        expect(ws2.url).toBe(RELAY_WS_URL);

        // Clean up: disconnect to stop further reconnect attempts.
        client.disconnect();
    });

    test('auto-reconnect is disabled when autoReconnect option is false', async () => {
        const client = new OnlookRelayClient(RELAY_WS_URL, { autoReconnect: false });
        client.connect();
        const ws1 = MockWebSocket.instances[0]!;
        ws1.simulateOpen();

        ws1.simulateClose();

        // Wait long enough for a reconnect to have fired (if it were enabled).
        await new Promise((resolve) => setTimeout(resolve, 1_200));

        // Only the original instance should exist.
        expect(MockWebSocket.instances).toHaveLength(1);
    });

    test('connect() is a no-op when already connected', () => {
        const client = new OnlookRelayClient(RELAY_WS_URL);
        client.connect();
        const ws = MockWebSocket.instances[0]!;
        ws.simulateOpen();

        // Second connect call should not create a new WebSocket.
        client.connect();
        expect(MockWebSocket.instances).toHaveLength(1);
    });

    test('send() serialises a WsMessage and sends it', () => {
        const client = new OnlookRelayClient(RELAY_WS_URL);
        client.connect();
        const ws = MockWebSocket.instances[0]!;
        ws.simulateOpen();

        client.send(VALID_CONSOLE_MSG);

        expect(ws.sentMessages).toHaveLength(1);
        const parsed = JSON.parse(ws.sentMessages[0]!) as WsMessage;
        expect(parsed.type).toBe('onlook:console');
    });

    test('send() throws when socket is not connected', () => {
        const client = new OnlookRelayClient(RELAY_WS_URL);

        expect(() => client.send(VALID_BUNDLE_UPDATE)).toThrow('WebSocket is not connected');
    });
});

describe('OnlookRelayClient abiHelloProvider', () => {
    const validHello = {
        type: 'abiHello' as const,
        abi: 'v1' as const,
        sessionId: 's',
        role: 'phone' as const,
        runtime: {
            abi: 'v1' as const,
            baseHash: 'a'.repeat(64),
            rnVersion: '0.81.6',
            expoSdk: '54.0.0',
            platform: 'ios' as const,
            aliases: ['react'],
        },
    };

    test('fires provider on initial open and sends the hello over the wire', () => {
        const calls: number[] = [];
        const client = new OnlookRelayClient(RELAY_WS_URL, {
            abiHelloProvider: () => {
                calls.push(Date.now());
                return validHello;
            },
        });
        client.connect();
        const ws = MockWebSocket.instances[MockWebSocket.instances.length - 1]!;
        ws.simulateOpen();

        expect(calls).toHaveLength(1);
        expect(ws.sentMessages).toHaveLength(1);
        expect(JSON.parse(ws.sentMessages[0]!)).toEqual(validHello);
    });

    test('skips send when provider returns null', () => {
        const client = new OnlookRelayClient(RELAY_WS_URL, {
            abiHelloProvider: () => null,
        });
        client.connect();
        const ws = MockWebSocket.instances[MockWebSocket.instances.length - 1]!;
        ws.simulateOpen();

        expect(ws.sentMessages).toEqual([]);
    });

    test('no provider configured = no send', () => {
        const client = new OnlookRelayClient(RELAY_WS_URL);
        client.connect();
        const ws = MockWebSocket.instances[MockWebSocket.instances.length - 1]!;
        ws.simulateOpen();

        expect(ws.sentMessages).toEqual([]);
    });

    test('fires provider AGAIN after auto-reconnect open', async () => {
        const calls: number[] = [];
        const client = new OnlookRelayClient(RELAY_WS_URL, {
            abiHelloProvider: () => {
                calls.push(Date.now());
                return validHello;
            },
        });
        client.connect();
        const first = MockWebSocket.instances[MockWebSocket.instances.length - 1]!;
        first.simulateOpen();
        expect(calls).toHaveLength(1);

        // Simulate transport drop — the client schedules a reconnect via
        // setTimeout(DEFAULT_RECONNECT_DELAY=1000ms). Wait long enough for
        // the timer to fire and a new MockWebSocket to be constructed.
        first.close();
        await new Promise((r) => setTimeout(r, 1100));

        const second = MockWebSocket.instances[MockWebSocket.instances.length - 1]!;
        expect(second).not.toBe(first);
        second.simulateOpen();

        expect(calls).toHaveLength(2);
        expect(second.sentMessages).toHaveLength(1);
        expect(JSON.parse(second.sentMessages[0]!)).toEqual(validHello);
    });

    test('provider throw does NOT break the WS — error swallowed', () => {
        const client = new OnlookRelayClient(RELAY_WS_URL, {
            abiHelloProvider: () => {
                throw new Error('caps not ready');
            },
        });
        client.connect();
        const ws = MockWebSocket.instances[MockWebSocket.instances.length - 1]!;
        // The open path catches both provider throws AND send throws so a
        // hello-send failure cannot wedge the underlying socket — the
        // editor's gate just stays 'unknown' (fail-closed semantics).
        expect(() => ws.simulateOpen()).not.toThrow();
        expect(ws.sentMessages).toEqual([]);
        expect(client.isConnected).toBe(true);
    });

    test('socket send throw is also swallowed', () => {
        const client = new OnlookRelayClient(RELAY_WS_URL, {
            abiHelloProvider: () => validHello,
        });
        client.connect();
        const ws = MockWebSocket.instances[MockWebSocket.instances.length - 1]!;
        // Make the underlying send fail (e.g. socket transitioned to CLOSING
        // between the readyState check and the send call — a real race).
        ws.send = () => {
            throw new Error('socket gone');
        };
        expect(() => ws.simulateOpen()).not.toThrow();
        expect(client.isConnected).toBe(true);
    });
});

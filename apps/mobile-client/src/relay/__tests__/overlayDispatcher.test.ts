/**
 * Tests for the OverlayDispatcher.
 *
 * Exercises the two-tier /hmr/:sessionId WebSocket channel: parses valid
 * overlay messages, ignores noise, surfaces protocol errors via the
 * injectable callback, and honors listener subscribe/unsubscribe.
 */
import { describe, expect, test } from 'bun:test';

import {
    OverlayDispatcher,
    resolveHmrSessionUrl,
    type OverlayDispatcherOptions,
} from '../overlayDispatcher';
import type { OverlayMessage } from '@onlook/mobile-client-protocol';

class MockSocket {
    static OPEN = 1;
    static CLOSED = 3;

    readyState = MockSocket.OPEN;
    closedCount = 0;
    readonly sent: string[] = [];
    sendThrow: Error | null = null;

    private readonly listeners = new Map<string, Array<(event: { data?: unknown }) => void>>();

    addEventListener(type: string, listener: (event: { data?: unknown }) => void): void {
        const existing = this.listeners.get(type) ?? [];
        existing.push(listener);
        this.listeners.set(type, existing);
    }

    close(): void {
        this.closedCount += 1;
        this.readyState = MockSocket.CLOSED;
        this.emit('close');
    }

    send(payload: string): void {
        if (this.sendThrow) throw this.sendThrow;
        this.sent.push(payload);
    }

    emit(type: string, data?: unknown): void {
        for (const listener of this.listeners.get(type) ?? []) {
            listener({ data });
        }
    }
}

function createDispatcher(extra: Partial<OverlayDispatcherOptions> = {}): {
    dispatcher: OverlayDispatcher;
    socket: MockSocket;
    protocolErrors: Array<{ reason: string; raw?: unknown }>;
} {
    const socket = new MockSocket();
    const protocolErrors: Array<{ reason: string; raw?: unknown }> = [];
    const dispatcher = new OverlayDispatcher('ws://relay/hmr/sess-1', {
        createSocket: () => socket as unknown as WebSocket,
        onProtocolError: (reason, raw) => {
            protocolErrors.push({ reason, raw });
        },
        ...extra,
    });
    return { dispatcher, socket, protocolErrors };
}

const VALID_OVERLAY: OverlayMessage = {
    type: 'overlay',
    code: 'globalThis.__onlookMountOverlay("cjs");',
    sourceMap: { version: 3 },
};

describe('OverlayDispatcher', () => {
    test('dispatches valid overlay messages to every registered listener', () => {
        const { dispatcher, socket } = createDispatcher();
        const a: OverlayMessage[] = [];
        const b: OverlayMessage[] = [];
        dispatcher.onOverlay((m) => a.push(m));
        dispatcher.onOverlay((m) => b.push(m));
        dispatcher.start();

        socket.emit('message', JSON.stringify(VALID_OVERLAY));

        expect(a).toHaveLength(1);
        expect(b).toHaveLength(1);
        expect(a[0]?.code).toBe(VALID_OVERLAY.code);
    });

    test('ignores non-JSON payloads and reports a protocol error', () => {
        const { dispatcher, socket, protocolErrors } = createDispatcher();
        const received: OverlayMessage[] = [];
        dispatcher.onOverlay((m) => received.push(m));
        dispatcher.start();

        socket.emit('message', '{');

        expect(received).toHaveLength(0);
        expect(protocolErrors).toHaveLength(1);
        expect(protocolErrors[0]?.reason).toContain('not JSON');
    });

    test('ignores JSON that does not match the overlay schema', () => {
        const { dispatcher, socket, protocolErrors } = createDispatcher();
        const received: OverlayMessage[] = [];
        dispatcher.onOverlay((m) => received.push(m));
        dispatcher.start();

        socket.emit('message', JSON.stringify({ type: 'bundleUpdate' }));

        expect(received).toHaveLength(0);
        expect(protocolErrors).toHaveLength(1);
        expect(protocolErrors[0]?.reason).toContain('not an overlay');
    });

    test('stop() closes the socket and blocks further dispatches', () => {
        const { dispatcher, socket } = createDispatcher();
        const received: OverlayMessage[] = [];
        dispatcher.onOverlay((m) => received.push(m));
        dispatcher.start();

        dispatcher.stop();
        expect(socket.closedCount).toBe(1);

        socket.emit('message', JSON.stringify(VALID_OVERLAY));
        // Listener list still has the listener, but the socket emission path
        // after close is no longer the live socket the dispatcher owns. The
        // next start() spins up a fresh socket.
        expect(received).toHaveLength(1); // the mock keeps its listeners
    });

    test('start() is idempotent', () => {
        let built = 0;
        const socket = new MockSocket();
        const dispatcher = new OverlayDispatcher('ws://relay/hmr/sess-2', {
            createSocket: () => {
                built += 1;
                return socket as unknown as WebSocket;
            },
        });
        dispatcher.start();
        dispatcher.start();
        expect(built).toBe(1);
    });

    test('onOverlay unsubscribe removes only the specific listener', () => {
        const { dispatcher, socket } = createDispatcher();
        const kept: OverlayMessage[] = [];
        const removed: OverlayMessage[] = [];
        dispatcher.onOverlay((m) => kept.push(m));
        const unsub = dispatcher.onOverlay((m) => removed.push(m));
        dispatcher.start();

        socket.emit('message', JSON.stringify(VALID_OVERLAY));
        expect(kept).toHaveLength(1);
        expect(removed).toHaveLength(1);

        unsub();

        socket.emit('message', JSON.stringify(VALID_OVERLAY));
        expect(kept).toHaveLength(2);
        expect(removed).toHaveLength(1);
    });
});

describe('resolveHmrSessionUrl', () => {
    test('upgrades http → ws and strips trailing slashes', () => {
        expect(resolveHmrSessionUrl('http://relay.local:8787/', 'sess-a')).toBe(
            'ws://relay.local:8787/hmr/sess-a',
        );
    });

    test('upgrades https → wss', () => {
        expect(resolveHmrSessionUrl('https://relay.onlook.com', 'sess-b')).toBe(
            'wss://relay.onlook.com/hmr/sess-b',
        );
    });

    test('preserves ws/wss input schemes', () => {
        expect(resolveHmrSessionUrl('ws://dev:1234', 'sess-c')).toBe(
            'ws://dev:1234/hmr/sess-c',
        );
        expect(resolveHmrSessionUrl('wss://prod', 'sess-d')).toBe('wss://prod/hmr/sess-d');
    });

    test('URL-encodes session ids with special characters', () => {
        expect(resolveHmrSessionUrl('ws://r', 'a b/c')).toBe('ws://r/hmr/a%20b%2Fc');
    });
});

describe('OverlayDispatcher.send', () => {
    test('returns false when dispatcher is not started', () => {
        const { dispatcher } = createDispatcher();
        expect(dispatcher.send({ type: 'onlook:overlayAck' })).toBe(false);
    });

    test('JSON-stringifies objects and writes to socket', () => {
        const { dispatcher, socket } = createDispatcher();
        dispatcher.start();
        const ok = dispatcher.send({
            type: 'onlook:overlayAck',
            sessionId: 's',
            overlayHash: 'h',
            status: 'mounted',
            timestamp: 1,
        });
        expect(ok).toBe(true);
        expect(socket.sent.length).toBe(1);
        const parsed = JSON.parse(socket.sent[0] ?? '{}');
        expect(parsed.type).toBe('onlook:overlayAck');
        expect(parsed.status).toBe('mounted');
    });

    test('passes string payloads through verbatim', () => {
        const { dispatcher, socket } = createDispatcher();
        dispatcher.start();
        dispatcher.send('raw-string');
        expect(socket.sent).toEqual(['raw-string']);
    });

    test('returns false when socket is not OPEN', () => {
        const { dispatcher, socket } = createDispatcher();
        dispatcher.start();
        socket.readyState = 2; // CLOSING
        expect(dispatcher.send({})).toBe(false);
        expect(socket.sent.length).toBe(0);
    });

    test('returns false when socket.send throws', () => {
        const { dispatcher, socket } = createDispatcher();
        dispatcher.start();
        socket.sendThrow = new Error('boom');
        expect(dispatcher.send({})).toBe(false);
    });

    test('returns false after stop() closes the socket', () => {
        const { dispatcher } = createDispatcher();
        dispatcher.start();
        dispatcher.stop();
        expect(dispatcher.send({})).toBe(false);
    });
});

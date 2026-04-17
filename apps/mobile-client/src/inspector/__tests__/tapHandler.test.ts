/**
 * Tests for the inspector tap handler.
 *
 * Task: MC4.14
 * Validate: bun test apps/mobile-client/src/inspector/__tests__/tapHandler.test.ts
 *
 * Mocks the relay client so the handler can be exercised without opening a
 * real WebSocket. Covers the type-guard (`extractSource`) for valid /
 * missing / malformed inputs, the WS wire format, local listener fan-out,
 * and the null-source warning path.
 */

import { describe, expect, test } from 'bun:test';
import type { OnlookRelayClient, WsMessage } from '../../relay/wsClient';
import { TapHandler, extractSource, type TapSource } from '../tapHandler';

// ── Test doubles ─────────────────────────────────────────────────────────────

/**
 * Mock `OnlookRelayClient`. Captures every `send` call into an array and
 * exposes a `throwOnSend` flag for simulating a dropped socket.
 */
class MockRelayClient {
    public sent: WsMessage[] = [];
    public throwOnSend = false;

    send(msg: WsMessage): void {
        if (this.throwOnSend) {
            throw new Error('WebSocket is not connected');
        }
        this.sent.push(msg);
    }
}

/** Cast the mock to the public `OnlookRelayClient` interface. */
function asClient(mock: MockRelayClient): OnlookRelayClient {
    return mock as unknown as OnlookRelayClient;
}

/** A captured-warnings helper that swaps `console.warn` for a recorder. */
function makeWarn(): {
    warn: (message: string, detail?: unknown) => void;
    calls: Array<{ message: string; detail?: unknown }>;
} {
    const calls: Array<{ message: string; detail?: unknown }> = [];
    return {
        calls,
        warn: (message, detail) => {
            calls.push({ message, detail });
        },
    };
}

const VALID_SOURCE: TapSource = {
    fileName: 'App.tsx',
    lineNumber: 12,
    columnNumber: 8,
};

// ── extractSource ────────────────────────────────────────────────────────────

describe('extractSource', () => {
    test('returns the source when __source is well-formed', () => {
        const props = {
            style: { color: 'red' },
            __source: { fileName: 'App.tsx', lineNumber: 12, columnNumber: 8 },
        };
        const result = extractSource(props);
        expect(result).toEqual(VALID_SOURCE);
    });

    test('returns null when props are missing __source', () => {
        const props = { style: { color: 'red' } };
        expect(extractSource(props)).toBeNull();
    });

    test('returns null when props is null or a primitive', () => {
        expect(extractSource(null)).toBeNull();
        expect(extractSource(undefined)).toBeNull();
        expect(extractSource(42)).toBeNull();
        expect(extractSource('props')).toBeNull();
    });

    test('returns null when __source is malformed (wrong types)', () => {
        // fileName not a string
        expect(
            extractSource({ __source: { fileName: 1, lineNumber: 1, columnNumber: 0 } }),
        ).toBeNull();
        // lineNumber not a positive integer
        expect(
            extractSource({ __source: { fileName: 'a.tsx', lineNumber: 0, columnNumber: 0 } }),
        ).toBeNull();
        expect(
            extractSource({
                fileName: 'a.tsx',
                __source: { fileName: 'a.tsx', lineNumber: 1.5, columnNumber: 0 },
            }),
        ).toBeNull();
        // columnNumber negative
        expect(
            extractSource({ __source: { fileName: 'a.tsx', lineNumber: 1, columnNumber: -1 } }),
        ).toBeNull();
        // Missing columnNumber entirely
        expect(
            extractSource({ __source: { fileName: 'a.tsx', lineNumber: 1 } }),
        ).toBeNull();
        // fileName empty string
        expect(
            extractSource({ __source: { fileName: '', lineNumber: 1, columnNumber: 0 } }),
        ).toBeNull();
    });

    test('returns null when __source is a non-object', () => {
        expect(extractSource({ __source: 'App.tsx' })).toBeNull();
        expect(extractSource({ __source: null })).toBeNull();
    });
});

// ── TapHandler ───────────────────────────────────────────────────────────────

describe('TapHandler.handleTap', () => {
    test('sends a schema-valid onlook:select message when source is present', () => {
        const client = new MockRelayClient();
        const { warn, calls } = makeWarn();
        const handler = new TapHandler(asClient(client), {
            sessionId: 'sess-abc-123',
            warn,
        });
        handler.setReactTag(42);

        handler.handleTap(VALID_SOURCE);

        expect(client.sent).toHaveLength(1);
        expect(client.sent[0]).toEqual({
            type: 'onlook:select',
            sessionId: 'sess-abc-123',
            reactTag: 42,
            source: {
                fileName: 'App.tsx',
                lineNumber: 12,
                columnNumber: 8,
            },
        });
        expect(calls).toHaveLength(0);
    });

    test('uses the default session id "unknown" when none is provided', () => {
        const client = new MockRelayClient();
        const handler = new TapHandler(asClient(client), { warn: () => {} });

        handler.handleTap(VALID_SOURCE);

        expect(client.sent).toHaveLength(1);
        const msg = client.sent[0];
        if (msg === undefined || msg.type !== 'onlook:select') {
            throw new Error('expected an onlook:select message');
        }
        expect(msg.sessionId).toBe('unknown');
        expect(msg.reactTag).toBe(0);
    });

    test('setSessionId updates the session id on subsequent sends', () => {
        const client = new MockRelayClient();
        const handler = new TapHandler(asClient(client), {
            sessionId: 'old-session',
            warn: () => {},
        });

        handler.handleTap(VALID_SOURCE);
        handler.setSessionId('new-session');
        handler.handleTap(VALID_SOURCE);

        expect(client.sent).toHaveLength(2);
        const first = client.sent[0];
        const second = client.sent[1];
        if (first === undefined || first.type !== 'onlook:select') {
            throw new Error('expected onlook:select');
        }
        if (second === undefined || second.type !== 'onlook:select') {
            throw new Error('expected onlook:select');
        }
        expect(first.sessionId).toBe('old-session');
        expect(second.sessionId).toBe('new-session');
    });

    test('does not send when source is null and logs a warning', () => {
        const client = new MockRelayClient();
        const { warn, calls } = makeWarn();
        const handler = new TapHandler(asClient(client), {
            sessionId: 'sess-abc',
            warn,
        });

        handler.handleTap(null);

        expect(client.sent).toHaveLength(0);
        expect(calls).toHaveLength(1);
        expect(calls[0]?.message).toContain('__source');
    });

    test('swallows send errors and logs a warning', () => {
        const client = new MockRelayClient();
        client.throwOnSend = true;
        const { warn, calls } = makeWarn();
        const handler = new TapHandler(asClient(client), {
            sessionId: 'sess-abc',
            warn,
        });

        // Must not throw.
        handler.handleTap(VALID_SOURCE);

        expect(client.sent).toHaveLength(0);
        expect(calls).toHaveLength(1);
        expect(calls[0]?.message).toContain('Failed to send');
    });
});

describe('TapHandler.onTap', () => {
    test('fires local listeners with the tapped source', () => {
        const client = new MockRelayClient();
        const handler = new TapHandler(asClient(client), { warn: () => {} });
        const received: TapSource[] = [];
        const unsubscribe = handler.onTap((src) => {
            received.push(src);
        });

        handler.handleTap(VALID_SOURCE);
        handler.handleTap({ fileName: 'B.tsx', lineNumber: 3, columnNumber: 1 });

        expect(received).toHaveLength(2);
        expect(received[0]).toEqual(VALID_SOURCE);
        expect(received[1]).toEqual({ fileName: 'B.tsx', lineNumber: 3, columnNumber: 1 });

        // Unsubscribe and confirm no further invocations.
        unsubscribe();
        handler.handleTap(VALID_SOURCE);
        expect(received).toHaveLength(2);
    });

    test('does not fire listeners when source is null', () => {
        const client = new MockRelayClient();
        const handler = new TapHandler(asClient(client), { warn: () => {} });
        const received: TapSource[] = [];
        handler.onTap((src) => {
            received.push(src);
        });

        handler.handleTap(null);

        expect(received).toHaveLength(0);
    });

    test('still fires listeners when the WS send throws (best-effort fan-out)', () => {
        const client = new MockRelayClient();
        client.throwOnSend = true;
        const handler = new TapHandler(asClient(client), { warn: () => {} });
        const received: TapSource[] = [];
        handler.onTap((src) => {
            received.push(src);
        });

        handler.handleTap(VALID_SOURCE);

        expect(client.sent).toHaveLength(0);
        expect(received).toHaveLength(1);
        expect(received[0]).toEqual(VALID_SOURCE);
    });
});

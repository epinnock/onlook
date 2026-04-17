/**
 * Tests for the network streamer.
 *
 * Task: MC5.5
 * Validate: bun test apps/mobile-client/src/debug/__tests__/networkStreamer.test.ts
 *
 * Mocks the relay client plus both patch sources so the streamer can be
 * exercised without opening a real WebSocket or patching global APIs.
 */

import { beforeEach, describe, expect, test } from 'bun:test';
import type { NetworkMessage } from '@onlook/mobile-client-protocol';
import type { OnlookRelayClient, WsMessage } from '../../relay/wsClient';
import type { NetworkEntry } from '../fetchPatch';
import { NetworkStreamer } from '../networkStreamer';

// ── Test doubles ─────────────────────────────────────────────────────────────

type EntryListener = (entry: NetworkEntry) => void;

/**
 * Minimal stand-in that exposes only the surface the streamer uses from a
 * network patch: `onEntry(handler) → unsubscribe` and an `emit` helper for
 * tests.
 */
class MockPatch {
    private _listeners = new Set<EntryListener>();
    public subscribeCount = 0;
    public unsubscribeCount = 0;

    onEntry(handler: EntryListener): () => void {
        this._listeners.add(handler);
        this.subscribeCount++;
        return () => {
            this._listeners.delete(handler);
            this.unsubscribeCount++;
        };
    }

    /** Test helper — deliver an entry to every current listener. */
    emit(entry: NetworkEntry): void {
        for (const handler of this._listeners) {
            handler(entry);
        }
    }

    get listenerCount(): number {
        return this._listeners.size;
    }
}

/**
 * Mock `OnlookRelayClient`. Captures every `send` call into an array and
 * exposes an `isConnected` flag tests can toggle at will. `throwOnSend`
 * simulates the socket closing between `isConnected` and the write.
 */
class MockRelayClient {
    public sent: WsMessage[] = [];
    public isConnected = true;
    public throwOnSend = false;

    send(msg: WsMessage): void {
        if (this.throwOnSend) {
            throw new Error('WebSocket is not connected');
        }
        this.sent.push(msg);
    }
}

/** Helper: cast the mock client to the public type the streamer expects. */
function asClient(mock: MockRelayClient): OnlookRelayClient {
    return mock as unknown as OnlookRelayClient;
}

/** Build a minimal successful NetworkEntry. */
function makeEntry(overrides: Partial<NetworkEntry> = {}): NetworkEntry {
    const base: NetworkEntry = {
        id: 'req-1',
        method: 'GET',
        url: 'https://example.com/data',
        status: 200,
        startTime: '2026-04-11T12:00:00.000Z',
        endTime: '2026-04-11T12:00:00.500Z',
        duration: 500,
    };
    // `Object.assign` preserves `null` values in `overrides` (unlike `??`),
    // which matters for error-path tests that explicitly null out `status`
    // and `duration`.
    return Object.assign(base, overrides);
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('NetworkStreamer', () => {
    let client: MockRelayClient;
    let fetchMock: MockPatch;
    let xhrMock: MockPatch;
    let streamer: NetworkStreamer;

    beforeEach(() => {
        client = new MockRelayClient();
        fetchMock = new MockPatch();
        xhrMock = new MockPatch();
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        streamer = new NetworkStreamer(
            asClient(client),
            { fetchPatch: fetchMock as any, xhrPatch: xhrMock as any },
            { sessionId: 'sess-test' },
        );
    });

    test('start() subscribes to both the fetch and XHR sources', () => {
        expect(fetchMock.listenerCount).toBe(0);
        expect(xhrMock.listenerCount).toBe(0);

        streamer.start();

        expect(fetchMock.listenerCount).toBe(1);
        expect(xhrMock.listenerCount).toBe(1);
        expect(fetchMock.subscribeCount).toBe(1);
        expect(xhrMock.subscribeCount).toBe(1);
    });

    test('entries from the fetch source are forwarded as onlook:network messages', () => {
        streamer.start();

        fetchMock.emit(
            makeEntry({
                id: 'fetch-abc',
                method: 'POST',
                url: 'https://api.onlook.dev/foo',
                status: 201,
                duration: 42,
            }),
        );

        expect(client.sent).toHaveLength(1);
        const msg = client.sent[0] as NetworkMessage;
        expect(msg.type).toBe('onlook:network');
        expect(msg.sessionId).toBe('sess-test');
        expect(msg.requestId).toBe('fetch-abc');
        expect(msg.method).toBe('POST');
        expect(msg.url).toBe('https://api.onlook.dev/foo');
        expect(msg.status).toBe(201);
        expect(msg.durationMs).toBe(42);
        expect(msg.phase).toBe('end');
        expect(typeof msg.timestamp).toBe('number');
    });

    test('entries from the XHR source are forwarded as onlook:network messages', () => {
        streamer.start();

        xhrMock.emit(
            makeEntry({
                id: 'xhr-xyz',
                method: 'GET',
                url: 'https://api.onlook.dev/bar',
                status: 200,
                duration: 17,
            }),
        );

        expect(client.sent).toHaveLength(1);
        const msg = client.sent[0] as NetworkMessage;
        expect(msg.type).toBe('onlook:network');
        expect(msg.requestId).toBe('xhr-xyz');
        expect(msg.method).toBe('GET');
        expect(msg.url).toBe('https://api.onlook.dev/bar');
        expect(msg.phase).toBe('end');
    });

    test('entries carrying an error map to phase="error"', () => {
        streamer.start();
        fetchMock.emit(
            makeEntry({
                id: 'err-1',
                status: null,
                duration: null,
                error: 'Network failure',
            }),
        );

        expect(client.sent).toHaveLength(1);
        const msg = client.sent[0] as NetworkMessage;
        expect(msg.phase).toBe('error');
        // status/durationMs are omitted when the entry fields are null.
        expect(msg.status).toBeUndefined();
        expect(msg.durationMs).toBeUndefined();
    });

    test('stop() unsubscribes from both sources', () => {
        streamer.start();
        expect(fetchMock.listenerCount).toBe(1);
        expect(xhrMock.listenerCount).toBe(1);

        streamer.stop();

        expect(fetchMock.listenerCount).toBe(0);
        expect(xhrMock.listenerCount).toBe(0);
        expect(fetchMock.unsubscribeCount).toBe(1);
        expect(xhrMock.unsubscribeCount).toBe(1);
    });

    test('stop() causes further source emissions to be ignored', () => {
        streamer.start();
        streamer.stop();

        fetchMock.emit(makeEntry({ id: 'after-stop-fetch' }));
        xhrMock.emit(makeEntry({ id: 'after-stop-xhr' }));

        expect(client.sent).toHaveLength(0);
    });

    test('disconnected client buffers messages instead of sending', () => {
        client.isConnected = false;
        streamer.start();

        fetchMock.emit(makeEntry({ id: 'buf-1' }));
        xhrMock.emit(makeEntry({ id: 'buf-2' }));
        fetchMock.emit(makeEntry({ id: 'buf-3' }));

        expect(client.sent).toHaveLength(0);
        expect(streamer.pendingCount).toBe(3);
    });

    test('send() throwing falls back to buffering (connected-but-racing socket)', () => {
        client.throwOnSend = true;
        streamer.start();

        fetchMock.emit(makeEntry({ id: 'race-1' }));

        expect(client.sent).toHaveLength(0);
        expect(streamer.pendingCount).toBe(1);
    });

    test('buffer flushes on the next start() once reconnected', () => {
        // Phase 1: streamer is running but the socket is down.
        client.isConnected = false;
        streamer.start();
        fetchMock.emit(makeEntry({ id: 'queued-1' }));
        xhrMock.emit(makeEntry({ id: 'queued-2' }));
        expect(streamer.pendingCount).toBe(2);
        expect(client.sent).toHaveLength(0);

        // Phase 2: the app detects the disconnect and pauses the streamer.
        streamer.stop();
        expect(streamer.pendingCount).toBe(2); // stop does not drop buffered entries

        // Phase 3: reconnect, restart — buffered messages should drain in
        // arrival order.
        client.isConnected = true;
        streamer.start();

        expect(streamer.pendingCount).toBe(0);
        expect(client.sent).toHaveLength(2);
        const [first, second] = client.sent as NetworkMessage[];
        expect(first?.requestId).toBe('queued-1');
        expect(second?.requestId).toBe('queued-2');
    });

    test('setSessionId updates the session stamped on later messages', () => {
        streamer.start();

        fetchMock.emit(makeEntry({ id: 'before' }));
        streamer.setSessionId('sess-new');
        xhrMock.emit(makeEntry({ id: 'after' }));

        expect(client.sent).toHaveLength(2);
        const [a, b] = client.sent as NetworkMessage[];
        expect(a?.sessionId).toBe('sess-test');
        expect(b?.sessionId).toBe('sess-new');
    });

    test('defaults sessionId to "unknown" when the option is omitted', () => {
        const s = new NetworkStreamer(
            asClient(client),
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            { fetchPatch: fetchMock as any, xhrPatch: xhrMock as any },
        );
        s.start();
        fetchMock.emit(makeEntry({ id: 'anon' }));

        const msg = client.sent[0] as NetworkMessage;
        expect(msg.sessionId).toBe('unknown');

        s.stop();
    });

    test('double start() is a no-op (does not re-subscribe)', () => {
        streamer.start();
        streamer.start();

        expect(fetchMock.subscribeCount).toBe(1);
        expect(xhrMock.subscribeCount).toBe(1);
        expect(fetchMock.listenerCount).toBe(1);
    });
});

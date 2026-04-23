import { beforeEach, describe, expect, mock, test } from 'bun:test';

import { RelayWsClient } from '../relay-ws-client';

/**
 * Mock WebSocket that captures listeners + lets tests drive the
 * open/close/message events synchronously.
 */
class MockWebSocket {
    static OPEN = 1;
    static CLOSED = 3;

    readyState = 0;
    closedCount = 0;
    readonly url: string;
    readonly sent: string[] = [];
    private listeners = new Map<string, Array<(ev: unknown) => void>>();

    constructor(url: string) {
        this.url = url;
    }

    addEventListener(type: string, listener: (ev: unknown) => void): void {
        const l = this.listeners.get(type) ?? [];
        l.push(listener);
        this.listeners.set(type, l);
    }
    removeEventListener(type: string, listener: (ev: unknown) => void): void {
        const l = this.listeners.get(type);
        if (!l) return;
        const idx = l.indexOf(listener);
        if (idx >= 0) l.splice(idx, 1);
    }
    close(): void {
        this.closedCount += 1;
        this.readyState = MockWebSocket.CLOSED;
        this.fire('close');
    }
    send(payload: string): void {
        this.sent.push(payload);
    }
    fire(type: string, payload?: unknown): void {
        const l = this.listeners.get(type) ?? [];
        for (const fn of [...l]) fn({ data: payload });
    }
}

function makeTimer() {
    type Pending = { id: number; fn: () => void; delay: number };
    let nextId = 1;
    const pending: Pending[] = [];
    const setTimeoutFn = (fn: () => void, delay: number): unknown => {
        const id = nextId++;
        pending.push({ id, fn, delay });
        return id;
    };
    const clearTimeoutFn = (handle: unknown): void => {
        const idx = pending.findIndex((p) => p.id === handle);
        if (idx >= 0) pending.splice(idx, 1);
    };
    const runNext = (): boolean => {
        const next = pending.shift();
        if (!next) return false;
        next.fn();
        return true;
    };
    return { setTimeoutFn, clearTimeoutFn, runNext, pendingCount: () => pending.length };
}

const validAck = {
    type: 'onlook:overlayAck' as const,
    sessionId: 'sess',
    overlayHash: 'h-1',
    status: 'mounted' as const,
    timestamp: 1,
};

const validConsole = {
    type: 'onlook:console' as const,
    sessionId: 'sess',
    level: 'log' as const,
    args: ['hello'],
    timestamp: 2,
};

describe('RelayWsClient — URL + construction', () => {
    test('upgrades http base to ws and appends /hmr/:sessionId', () => {
        let captured = '';
        new RelayWsClient({
            relayBaseUrl: 'http://relay.local:8787',
            sessionId: 'sess-1',
            createSocket: (url) => {
                captured = url;
                return new MockWebSocket(url) as unknown as WebSocket;
            },
        }).disconnect();
        expect(captured).toBe('ws://relay.local:8787/hmr/sess-1');
    });

    test('upgrades https → wss', () => {
        let captured = '';
        new RelayWsClient({
            relayBaseUrl: 'https://prod.relay/',
            sessionId: 'sess',
            createSocket: (url) => {
                captured = url;
                return new MockWebSocket(url) as unknown as WebSocket;
            },
        }).disconnect();
        expect(captured).toBe('wss://prod.relay/hmr/sess');
    });

    test('url-encodes session id', () => {
        let captured = '';
        new RelayWsClient({
            relayBaseUrl: 'ws://relay',
            sessionId: 'a b/c',
            createSocket: (url) => {
                captured = url;
                return new MockWebSocket(url) as unknown as WebSocket;
            },
        }).disconnect();
        expect(captured).toBe('ws://relay/hmr/a%20b%2Fc');
    });
});

describe('RelayWsClient — state + buffering', () => {
    let socket: MockWebSocket;
    let client: RelayWsClient;
    let timer: ReturnType<typeof makeTimer>;
    const states: string[] = [];

    beforeEach(() => {
        states.length = 0;
        timer = makeTimer();
        client = new RelayWsClient({
            relayBaseUrl: 'ws://relay',
            sessionId: 'sess',
            createSocket: (url) => {
                socket = new MockWebSocket(url);
                return socket as unknown as WebSocket;
            },
            setTimeout: timer.setTimeoutFn,
            clearTimeout: timer.clearTimeoutFn,
            onStateChange: (s) => states.push(s),
        });
    });

    test('initial state transitions: idle → connecting → open on socket open event', () => {
        expect(states).toEqual(['connecting']);
        socket.fire('open');
        expect(states).toEqual(['connecting', 'open']);
        expect(client.state).toBe('open');
        client.disconnect();
    });

    test('valid overlayAck message is appended to messages + acks', () => {
        socket.fire('open');
        socket.fire('message', JSON.stringify(validAck));
        const snap = client.snapshot();
        expect(snap.messages.length).toBe(1);
        expect(snap.acks.length).toBe(1);
        expect(snap.acks[0]?.overlayHash).toBe('h-1');
        client.disconnect();
    });

    test('other onlook:* messages append to messages but not acks', () => {
        socket.fire('open');
        socket.fire('message', JSON.stringify(validConsole));
        const snap = client.snapshot();
        expect(snap.messages.length).toBe(1);
        expect(snap.acks.length).toBe(0);
        client.disconnect();
    });

    test('invalid JSON does not push to buffer', () => {
        socket.fire('open');
        socket.fire('message', 'not-json');
        expect(client.snapshot().messages.length).toBe(0);
        client.disconnect();
    });

    test('buffer caps at bufferSize (FIFO)', () => {
        client.disconnect();
        const small = new RelayWsClient({
            relayBaseUrl: 'ws://relay',
            sessionId: 's',
            bufferSize: 3,
            createSocket: (url) => {
                socket = new MockWebSocket(url);
                return socket as unknown as WebSocket;
            },
            setTimeout: timer.setTimeoutFn,
            clearTimeout: timer.clearTimeoutFn,
        });
        socket.fire('open');
        for (let i = 0; i < 5; i++) {
            socket.fire('message', JSON.stringify({ ...validConsole, args: [`n${i}`] }));
        }
        const snap = small.snapshot();
        expect(snap.messages.length).toBe(3);
        expect((snap.messages[0] as { args: string[] }).args).toEqual(['n2']);
        expect((snap.messages[2] as { args: string[] }).args).toEqual(['n4']);
        small.disconnect();
    });
});

describe('RelayWsClient — handler callbacks', () => {
    test('onOverlayAck fires on matching payload', () => {
        let socketRef: MockWebSocket | null = null;
        const onOverlayAck = mock(() => {});
        const c = new RelayWsClient({
            relayBaseUrl: 'ws://relay',
            sessionId: 's',
            handlers: { onOverlayAck },
            createSocket: (url) => {
                socketRef = new MockWebSocket(url);
                return socketRef as unknown as WebSocket;
            },
        });
        socketRef!.fire('open');
        socketRef!.fire('message', JSON.stringify(validAck));
        expect(onOverlayAck).toHaveBeenCalledTimes(1);
        c.disconnect();
    });

    test('onAny fires for every parsed message (ack + console)', () => {
        let socketRef: MockWebSocket | null = null;
        const onAny = mock(() => {});
        const c = new RelayWsClient({
            relayBaseUrl: 'ws://relay',
            sessionId: 's',
            onAny,
            createSocket: (url) => {
                socketRef = new MockWebSocket(url);
                return socketRef as unknown as WebSocket;
            },
        });
        socketRef!.fire('open');
        socketRef!.fire('message', JSON.stringify(validAck));
        socketRef!.fire('message', JSON.stringify(validConsole));
        expect(onAny).toHaveBeenCalledTimes(2);
        c.disconnect();
    });
});

describe('RelayWsClient — reconnect', () => {
    test('schedules reconnect on close; second connection opens', () => {
        const sockets: MockWebSocket[] = [];
        const timer = makeTimer();
        const c = new RelayWsClient({
            relayBaseUrl: 'ws://relay',
            sessionId: 's',
            createSocket: (url) => {
                const s = new MockWebSocket(url);
                sockets.push(s);
                return s as unknown as WebSocket;
            },
            setTimeout: timer.setTimeoutFn,
            clearTimeout: timer.clearTimeoutFn,
            reconnectMinMs: 100,
        });
        sockets[0]!.fire('open');
        sockets[0]!.fire('close');
        expect(timer.pendingCount()).toBe(1);
        timer.runNext();
        expect(sockets.length).toBe(2); // reconnected
        sockets[1]!.fire('open');
        expect(c.state).toBe('open');
        c.disconnect();
    });

    test('disconnect cancels any pending reconnect timer', () => {
        const sockets: MockWebSocket[] = [];
        const timer = makeTimer();
        const c = new RelayWsClient({
            relayBaseUrl: 'ws://relay',
            sessionId: 's',
            createSocket: (url) => {
                const s = new MockWebSocket(url);
                sockets.push(s);
                return s as unknown as WebSocket;
            },
            setTimeout: timer.setTimeoutFn,
            clearTimeout: timer.clearTimeoutFn,
        });
        sockets[0]!.fire('open');
        sockets[0]!.fire('close');
        expect(timer.pendingCount()).toBe(1);
        c.disconnect();
        expect(timer.pendingCount()).toBe(0);
    });

    test('exponential backoff caps at reconnectMaxMs', () => {
        const sockets: MockWebSocket[] = [];
        const delays: number[] = [];
        const fakeSetTimeout = (fn: () => void, d: number): unknown => {
            delays.push(d);
            return fn; // no-op, we just record
        };
        const fakeClearTimeout = (_: unknown): void => undefined;
        const c = new RelayWsClient({
            relayBaseUrl: 'ws://relay',
            sessionId: 's',
            createSocket: (url) => {
                const s = new MockWebSocket(url);
                sockets.push(s);
                return s as unknown as WebSocket;
            },
            setTimeout: fakeSetTimeout,
            clearTimeout: fakeClearTimeout,
            reconnectMinMs: 100,
            reconnectMaxMs: 1000,
        });
        // 5 close events in a row — backoff doubles each time but caps at 1000.
        for (let i = 0; i < 5; i++) sockets[0]!.fire('close');
        expect(delays).toEqual([100, 200, 400, 800, 1000]);
        c.disconnect();
    });
});

describe('RelayWsClient — reconnect-replay (task #82)', () => {
    test('HmrSession-style replay payload on the fresh socket is ingested normally', () => {
        // Simulates: WS closes → RelayWsClient's backoff fires → second
        // connection opens → server immediately replays the last overlay
        // payload via the new socket (HmrSession.replayLastOverlay). The
        // client should surface it through onAny / onOverlayAck just like
        // any other push.
        const sockets: MockWebSocket[] = [];
        const timer = makeTimer();
        const acks: unknown[] = [];
        const c = new RelayWsClient({
            relayBaseUrl: 'ws://relay',
            sessionId: 's-replay',
            onAny: (m) => acks.push(m),
            setTimeout: timer.setTimeoutFn,
            clearTimeout: timer.clearTimeoutFn,
            createSocket: (url) => {
                const s = new MockWebSocket(url);
                sockets.push(s);
                return s as unknown as WebSocket;
            },
            reconnectMinMs: 50,
        });
        // Initial connection + first push.
        sockets[0]!.fire('open');
        sockets[0]!.fire(
            'message',
            JSON.stringify({
                ...validAck,
                overlayHash: 'h-first',
            }),
        );
        // Server disconnects (DO eviction, worker redeploy, etc.).
        sockets[0]!.fire('close');
        // Backoff fires, second connection opens, server replays latest.
        timer.runNext();
        expect(sockets.length).toBe(2);
        sockets[1]!.fire('open');
        sockets[1]!.fire(
            'message',
            JSON.stringify({
                ...validAck,
                overlayHash: 'h-replay',
            }),
        );
        expect(c.snapshot().acks.map((a) => a.overlayHash)).toEqual(['h-first', 'h-replay']);
        c.disconnect();
    });

    test('messages received on a stale socket after close() are dropped', () => {
        const sockets: MockWebSocket[] = [];
        const timer = makeTimer();
        const c = new RelayWsClient({
            relayBaseUrl: 'ws://relay',
            sessionId: 's',
            setTimeout: timer.setTimeoutFn,
            clearTimeout: timer.clearTimeoutFn,
            createSocket: (url) => {
                const s = new MockWebSocket(url);
                sockets.push(s);
                return s as unknown as WebSocket;
            },
        });
        sockets[0]!.fire('open');
        sockets[0]!.fire('close');
        // Fire a message on the now-unsubscribed socket — should not reach
        // the buffer since `subscribeRelayEvents.cancel()` removed the
        // listener on close.
        sockets[0]!.fire('message', JSON.stringify(validAck));
        expect(c.snapshot().messages.length).toBe(0);
        c.disconnect();
    });
});

describe('RelayWsClient — disconnect idempotence + side-effect cleanup', () => {
    test('disconnect closes the socket exactly once', () => {
        let ref: MockWebSocket | null = null;
        const c = new RelayWsClient({
            relayBaseUrl: 'ws://relay',
            sessionId: 's',
            createSocket: (url) => {
                ref = new MockWebSocket(url);
                return ref as unknown as WebSocket;
            },
        });
        c.disconnect();
        c.disconnect();
        expect(ref!.closedCount).toBe(1);
    });

    test('disconnect flips state to closed', () => {
        const states: string[] = [];
        const c = new RelayWsClient({
            relayBaseUrl: 'ws://relay',
            sessionId: 's',
            onStateChange: (s) => states.push(s),
            createSocket: (url) => new MockWebSocket(url) as unknown as WebSocket,
        });
        c.disconnect();
        expect(states[states.length - 1]).toBe('closed');
    });
});

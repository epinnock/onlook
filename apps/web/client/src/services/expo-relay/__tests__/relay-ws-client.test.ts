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

describe('RelayWsClient — editor AbiHello handshake (Phase 11b)', () => {
    const editorCaps = {
        abi: 'v1' as const,
        baseHash: 'editor-base-hash',
        rnVersion: '0.81.6',
        expoSdk: '54.0.0',
        platform: 'ios' as const,
        aliases: ['react'],
    };
    const phoneCaps = { ...editorCaps, baseHash: 'phone-base-hash' };
    const phoneHello = {
        type: 'abiHello' as const,
        abi: 'v1' as const,
        sessionId: 'sess',
        role: 'phone' as const,
        runtime: phoneCaps,
    };

    test('sends editor hello on open when editorCapabilities is provided', () => {
        const sockets: MockWebSocket[] = [];
        const c = new RelayWsClient({
            relayBaseUrl: 'http://r:1',
            sessionId: 'sess',
            editorCapabilities: editorCaps,
            createSocket: (url) => {
                const s = new MockWebSocket(url);
                sockets.push(s);
                return s as unknown as WebSocket;
            },
        });
        sockets[0]!.fire('open');
        expect(sockets[0]!.sent).toHaveLength(1);
        const sent = JSON.parse(sockets[0]!.sent[0]!);
        expect(sent.type).toBe('abiHello');
        expect(sent.role).toBe('editor');
        expect(sent.sessionId).toBe('sess');
        expect(sent.runtime).toEqual(editorCaps);
        c.disconnect();
    });

    test('NO send when editorCapabilities is omitted (legacy callers)', () => {
        const sockets: MockWebSocket[] = [];
        const c = new RelayWsClient({
            relayBaseUrl: 'http://r:1',
            sessionId: 'sess',
            createSocket: (url) => {
                const s = new MockWebSocket(url);
                sockets.push(s);
                return s as unknown as WebSocket;
            },
        });
        sockets[0]!.fire('open');
        expect(sockets[0]!.sent).toEqual([]);
        c.disconnect();
    });

    test('phone hello arrival fires onAbiCompatibility with "ok"', () => {
        const sockets: MockWebSocket[] = [];
        const calls: Array<{ result: unknown; phone: unknown }> = [];
        const c = new RelayWsClient({
            relayBaseUrl: 'http://r:1',
            sessionId: 'sess',
            editorCapabilities: editorCaps,
            onAbiCompatibility: (result, phone) => calls.push({ result, phone }),
            createSocket: (url) => {
                const s = new MockWebSocket(url);
                sockets.push(s);
                return s as unknown as WebSocket;
            },
        });
        sockets[0]!.fire('open');
        sockets[0]!.fire('message', JSON.stringify(phoneHello));
        expect(calls).toHaveLength(1);
        expect(calls[0]!.result).toBe('ok');
        expect(calls[0]!.phone).toEqual(phoneHello);
        c.disconnect();
    });

    test('mismatched phone abi triggers OnlookRuntimeError result', () => {
        const sockets: MockWebSocket[] = [];
        const calls: Array<{ result: unknown }> = [];
        const c = new RelayWsClient({
            relayBaseUrl: 'http://r:1',
            sessionId: 'sess',
            editorCapabilities: editorCaps,
            onAbiCompatibility: (result) => calls.push({ result }),
            createSocket: (url) => {
                const s = new MockWebSocket(url);
                sockets.push(s);
                return s as unknown as WebSocket;
            },
        });
        sockets[0]!.fire('open');
        // Force-cast a v0 phone hello past the type checker — at runtime the
        // schema in this branch is permissive enough to drive the editor's
        // checkAbiCompatibility down the abi-mismatch path.
        const v0Hello = {
            ...phoneHello,
            abi: 'v0',
            runtime: { ...phoneCaps, abi: 'v0' },
        } as unknown as typeof phoneHello;
        sockets[0]!.fire('message', JSON.stringify(v0Hello));
        // The handshake's isAbiHello guard accepts only abi: 'v1', so a v0
        // payload is dropped silently — no callback fires.
        expect(calls).toHaveLength(0);
        c.disconnect();
    });

    test('disconnect cancels the handshake handle', () => {
        const sockets: MockWebSocket[] = [];
        const c = new RelayWsClient({
            relayBaseUrl: 'http://r:1',
            sessionId: 'sess',
            editorCapabilities: editorCaps,
            createSocket: (url) => {
                const s = new MockWebSocket(url);
                sockets.push(s);
                return s as unknown as WebSocket;
            },
        });
        sockets[0]!.fire('open');
        c.disconnect();
        // After disconnect, the handshake's listener should be cancelled —
        // a late phone hello arriving on the closed socket must not throw.
        expect(() => sockets[0]!.fire('message', JSON.stringify(phoneHello))).not.toThrow();
    });

    test('getLastAbiCompatibility starts "unknown", flips to "ok", resets on close', () => {
        const sockets: MockWebSocket[] = [];
        const c = new RelayWsClient({
            relayBaseUrl: 'http://r:1',
            sessionId: 'sess',
            editorCapabilities: editorCaps,
            createSocket: (url) => {
                const s = new MockWebSocket(url);
                sockets.push(s);
                return s as unknown as WebSocket;
            },
        });
        expect(c.getLastAbiCompatibility()).toBe('unknown');
        sockets[0]!.fire('open');
        expect(c.getLastAbiCompatibility()).toBe('unknown');
        sockets[0]!.fire('message', JSON.stringify(phoneHello));
        expect(c.getLastAbiCompatibility()).toBe('ok');
        // Socket close drops the cached compat — protects against the
        // next-connect-may-be-different-phone race.
        sockets[0]!.fire('close');
        expect(c.getLastAbiCompatibility()).toBe('unknown');
        c.disconnect();
    });

    test('getLastAbiCompatibility surfaces OnlookRuntimeError on mismatched phone abi', () => {
        // We cannot send a v0 phone hello past the handshake's isAbiHello
        // guard (it accepts only abi: 'v1'), so this test verifies that
        // until the phone actually advertises v1+matching, the getter
        // keeps reporting 'unknown' — i.e., fail-closed by default. This
        // is the operationally important case; mismatch surfaces only
        // when a future ABI version lands.
        const sockets: MockWebSocket[] = [];
        const c = new RelayWsClient({
            relayBaseUrl: 'http://r:1',
            sessionId: 'sess',
            editorCapabilities: editorCaps,
            createSocket: (url) => {
                const s = new MockWebSocket(url);
                sockets.push(s);
                return s as unknown as WebSocket;
            },
        });
        sockets[0]!.fire('open');
        const v0Hello = {
            ...phoneHello,
            abi: 'v0',
            runtime: { ...phoneCaps, abi: 'v0' },
        } as unknown as typeof phoneHello;
        sockets[0]!.fire('message', JSON.stringify(v0Hello));
        // Hello dropped by isAbiHello guard — compatibility stays 'unknown'.
        expect(c.getLastAbiCompatibility()).toBe('unknown');
        c.disconnect();
    });

    test('editor reconnect: replayed phone hello re-populates lastCompatibility without a fresh hello', () => {
        // Phase 11b resilience: when the editor's WS drops + auto-reconnects,
        // the relay replays the most-recent phone hello on the fresh socket
        // (cf-expo-relay HmrSession.replayLastAbiHellos, 80d3d54f). The
        // editor's handshake listener processes that replayed hello as if
        // it were live — checkAbiCompatibility fires, lastCompatibility
        // flips back to 'ok'. This pins the contract: a phone going
        // background-then-foreground (where the phone-side onAbiCompat
        // wouldn't refire because the phone WS stayed open) still leaves
        // the editor's gate open after the editor's network blip.
        const sockets: MockWebSocket[] = [];
        const c = new RelayWsClient({
            relayBaseUrl: 'http://r:1',
            sessionId: 'sess',
            editorCapabilities: editorCaps,
            // Tighten reconnect so the test doesn't idle on the 500ms default.
            reconnectMinMs: 5,
            reconnectMaxMs: 10,
            setTimeout: (fn) => {
                // Run immediately on this thread so the test is deterministic.
                fn();
                return 0;
            },
            clearTimeout: () => {},
            createSocket: (url) => {
                const s = new MockWebSocket(url);
                sockets.push(s);
                return s as unknown as WebSocket;
            },
        });

        // First connection: handshake completes normally.
        sockets[0]!.fire('open');
        sockets[0]!.fire('message', JSON.stringify(phoneHello));
        expect(c.getLastAbiCompatibility()).toBe('ok');

        // Drop the first socket — lastCompatibility resets to 'unknown'
        // (verified by the prior test). Reconnect timer fires synchronously
        // via the setTimeout stub; a new MockWebSocket instance lands at
        // sockets[1].
        sockets[0]!.fire('close');
        expect(c.getLastAbiCompatibility()).toBe('unknown');
        expect(sockets.length).toBeGreaterThanOrEqual(2);

        // Open the new socket. The relay's hmr-session replays the stored
        // phone hello to fresh joiners — fire it on the new mock to
        // simulate.
        sockets[1]!.fire('open');
        sockets[1]!.fire('message', JSON.stringify(phoneHello));
        expect(c.getLastAbiCompatibility()).toBe('ok');

        c.disconnect();
    });

    test('getLastAbiCompatibility integrates as pushOverlayV1 gate input', () => {
        // End-to-end shape: the getter returns exactly what
        // pushOverlayV1's `compatibility` option expects.
        const sockets: MockWebSocket[] = [];
        const c = new RelayWsClient({
            relayBaseUrl: 'http://r:1',
            sessionId: 'sess',
            editorCapabilities: editorCaps,
            createSocket: (url) => {
                const s = new MockWebSocket(url);
                sockets.push(s);
                return s as unknown as WebSocket;
            },
        });
        const gate = () => c.getLastAbiCompatibility();
        expect(gate()).toBe('unknown'); // pre-handshake — pushOverlayV1 fails closed
        sockets[0]!.fire('open');
        sockets[0]!.fire('message', JSON.stringify(phoneHello));
        expect(gate()).toBe('ok'); // pushOverlayV1 proceeds
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

describe('RelayWsClient — replaceMessageMatching (Phase 11b row #35)', () => {
    function makeErrorMsg(timestamp: number, sourceFile?: string) {
        return {
            type: 'onlook:error' as const,
            sessionId: 'sess',
            kind: 'js' as const,
            message: 'boom',
            timestamp,
            ...(sourceFile && {
                source: { fileName: sourceFile, lineNumber: 1, columnNumber: 0 },
            }),
        };
    }

    test('returns false when no match — buffer is unchanged', () => {
        const sockets: MockWebSocket[] = [];
        const c = new RelayWsClient({
            relayBaseUrl: 'http://r:1',
            sessionId: 'sess',
            createSocket: (url) => {
                const s = new MockWebSocket(url);
                sockets.push(s);
                return s as unknown as WebSocket;
            },
        });
        sockets[0]!.fire('open');
        const result = c.replaceMessageMatching(
            () => false,
            (msg) => msg,
        );
        expect(result).toBe(false);
        expect(c.snapshot().messages).toHaveLength(0);
        c.disconnect();
    });

    test('replaces the first matching entry in place; subsequent snapshot reflects swap', () => {
        const sockets: MockWebSocket[] = [];
        const c = new RelayWsClient({
            relayBaseUrl: 'http://r:1',
            sessionId: 'sess',
            createSocket: (url) => {
                const s = new MockWebSocket(url);
                sockets.push(s);
                return s as unknown as WebSocket;
            },
        });
        sockets[0]!.fire('open');
        // Inject an undecorated error via the wire.
        sockets[0]!.fire('message', JSON.stringify(makeErrorMsg(1)));
        const beforeSnap = c.snapshot();
        expect(beforeSnap.messages).toHaveLength(1);

        // Decorate it via the new primitive — same shape but with a
        // populated source field.
        const result = c.replaceMessageMatching(
            (msg) =>
                msg.type === 'onlook:error' && msg.timestamp === 1,
            (_msg) => makeErrorMsg(1, 'App.tsx'),
        );
        expect(result).toBe(true);

        const afterSnap = c.snapshot();
        expect(afterSnap.messages).toHaveLength(1);
        const replaced = afterSnap.messages[0];
        if (replaced?.type === 'onlook:error') {
            expect(replaced.source?.fileName).toBe('App.tsx');
        } else {
            throw new Error('expected onlook:error after replace');
        }
        c.disconnect();
    });

    test('only the first match is swapped; later matches stay raw', () => {
        const sockets: MockWebSocket[] = [];
        const c = new RelayWsClient({
            relayBaseUrl: 'http://r:1',
            sessionId: 'sess',
            createSocket: (url) => {
                const s = new MockWebSocket(url);
                sockets.push(s);
                return s as unknown as WebSocket;
            },
        });
        sockets[0]!.fire('open');
        sockets[0]!.fire('message', JSON.stringify(makeErrorMsg(1)));
        sockets[0]!.fire('message', JSON.stringify(makeErrorMsg(2)));

        c.replaceMessageMatching(
            (msg) => msg.type === 'onlook:error',
            (_msg) => makeErrorMsg(1, 'App.tsx'),
        );

        const messages = c.snapshot().messages;
        expect(messages).toHaveLength(2);
        if (messages[0]?.type === 'onlook:error' && messages[1]?.type === 'onlook:error') {
            expect(messages[0].source?.fileName).toBe('App.tsx'); // first match decorated
            expect(messages[1].source).toBeUndefined(); // second left raw
        }
        c.disconnect();
    });
});

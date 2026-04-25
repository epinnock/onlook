/// <reference types="bun" />
/**
 * Stress test for HmrSession fan-out under rapid sequential pushes.
 *
 * Fires 50 POST /push calls back-to-back against a single HmrSession with
 * 3 connected sockets and asserts: (a) every socket receives every payload
 * in-order, (b) the delivered count stays at 3 for every push, (c) the
 * last-overlay replay after everything settles returns the 50th payload.
 */
import { beforeAll, beforeEach, describe, expect, mock, test } from 'bun:test';

mock.module('cloudflare:workers', () => ({
    DurableObject: class {
        protected ctx: unknown;
        protected env: unknown;
        constructor(ctx: unknown, env: unknown) {
            this.ctx = ctx;
            this.env = env;
        }
    },
}));

type HmrSessionModule = typeof import('../do/hmr-session');
let HmrSession: HmrSessionModule['HmrSession'];
const pairs: MockWebSocketPair[] = [];

class MockWebSocket {
    static OPEN = 1;
    readyState = MockWebSocket.OPEN;
    readonly sent: string[] = [];
    private readonly listeners = new Map<string, Array<(event: { data?: unknown }) => void>>();

    accept(): void {}
    send(message: string): void {
        this.sent.push(message);
    }
    addEventListener(type: string, listener: (event: { data?: unknown }) => void): void {
        const xs = this.listeners.get(type) ?? [];
        xs.push(listener);
        this.listeners.set(type, xs);
    }
    emit(type: string, data?: unknown): void {
        (this.listeners.get(type) ?? []).forEach((l) => l({ data }));
    }
    close(): void {
        this.readyState = 3;
    }
}

class MockWebSocketPair {
    readonly client: MockWebSocket;
    readonly server: MockWebSocket;
    constructor() {
        this.client = new MockWebSocket();
        this.server = new MockWebSocket();
        Object.assign(this as object, { 0: this.client, 1: this.server });
        pairs.push(this);
    }
}

beforeEach(() => {
    pairs.length = 0;
});

beforeAll(async () => {
    const runtime = globalThis as typeof globalThis & { WebSocketPair?: unknown };
    Object.defineProperty(runtime, 'WebSocketPair', {
        configurable: true,
        writable: true,
        value: MockWebSocketPair,
    });
    const mod: HmrSessionModule = await import('../do/hmr-session');
    HmrSession = mod.HmrSession;
});

function makeState(): DurableObjectState {
    return {
        id: {
            name: 'stress-session',
            toString: () => 'stress-session',
        } as DurableObjectId,
    } as DurableObjectState;
}

async function openSocket(
    session: InstanceType<HmrSessionModule['HmrSession']>,
): Promise<MockWebSocketPair> {
    const response = await session.fetch(
        new Request('https://hmr-relay.dev.workers.dev/', {
            headers: { Upgrade: 'websocket' },
        }),
    );
    expect(response.status).toBe(101);
    const pair = pairs[pairs.length - 1];
    expect(pair).toBeDefined();
    return pair as MockWebSocketPair;
}

async function push(
    session: InstanceType<HmrSessionModule['HmrSession']>,
    code: string,
): Promise<{ delivered: number }> {
    const resp = await session.fetch(
        new Request('https://hmr-relay.dev.workers.dev/push', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ type: 'overlay', code }),
        }),
    );
    expect(resp.status).toBe(202);
    return (await resp.json()) as { delivered: number };
}

describe('HmrSession stress — rapid sequential pushes', () => {
    const N = 50;
    const CONNECTIONS = 3;

    test(`${N} back-to-back pushes to ${CONNECTIONS} sockets preserve order + delivered count`, async () => {
        const session = new HmrSession(makeState(), {});
        const sockets: MockWebSocketPair[] = [];
        for (let i = 0; i < CONNECTIONS; i += 1) {
            sockets.push(await openSocket(session));
        }

        const codes: string[] = [];
        for (let i = 0; i < N; i += 1) {
            const code = `globalThis.__onlookMountOverlay("push-${i}");`;
            codes.push(code);
            const { delivered } = await push(session, code);
            expect(delivered).toBe(CONNECTIONS);
        }

        for (const pair of sockets) {
            expect(pair.server.sent).toHaveLength(N);
            for (let i = 0; i < N; i += 1) {
                const parsed = JSON.parse(pair.server.sent[i]!) as {
                    code: string;
                };
                expect(parsed.code).toBe(codes[i]);
            }
        }

        // Late joiner must receive the final overlay as the replay payload.
        const lateJoiner = await openSocket(session);
        expect(lateJoiner.server.sent).toHaveLength(1);
        const replay = JSON.parse(lateJoiner.server.sent[0]!) as { code: string };
        expect(replay.code).toBe(codes[N - 1]);
    });

    test('closed sockets drop out of the delivered count without stalling the stream', async () => {
        const session = new HmrSession(makeState(), {});
        const a = await openSocket(session);
        const b = await openSocket(session);
        const c = await openSocket(session);

        await push(session, 'first');
        b.server.close();

        const { delivered } = await push(session, 'second');
        expect(delivered).toBe(2);

        expect(a.server.sent).toHaveLength(2);
        expect(c.server.sent).toHaveLength(2);
        expect(b.server.sent).toHaveLength(1); // only the pre-close broadcast
    });
});

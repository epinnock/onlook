/// <reference types="bun" />
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
        const existing = this.listeners.get(type) ?? [];
        existing.push(listener);
        this.listeners.set(type, existing);
    }

    emit(type: string, data?: unknown): void {
        for (const listener of this.listeners.get(type) ?? []) {
            listener({ data });
        }
    }

    close(): void {
        this.readyState = 3;
        this.emit('close');
    }
}

class MockWebSocketPair {
    readonly client: MockWebSocket;
    readonly server: MockWebSocket;

    constructor() {
        this.client = new MockWebSocket();
        this.server = new MockWebSocket();
        Object.assign(this as object, {
            0: this.client,
            1: this.server,
        });
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
            name: 'hmr-session-1',
            toString: () => 'hmr-session-1',
        } as DurableObjectId,
    } as DurableObjectState;
}

function makeSession(): InstanceType<HmrSessionModule['HmrSession']> {
    return new HmrSession(makeState(), {});
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

describe('HmrSession overlay fan-out', () => {
    test('accepts a websocket upgrade at /', async () => {
        const response = await makeSession().fetch(
            new Request('https://hmr-relay.dev.workers.dev/', {
                headers: { Upgrade: 'websocket' },
            }),
        );

        expect(response.status).toBe(101);
    });

    test('broadcasts valid overlay payloads to other connected sockets', async () => {
        const session = makeSession();
        const first = await openSocket(session);
        const second = await openSocket(session);

        const payload = {
            type: 'overlay',
            code: 'console.log("hello");',
            sourceMap: { version: 3 },
        };

        first.server.emit('message', JSON.stringify(payload));

        expect(first.server.sent).toEqual([]);
        expect(second.server.sent).toEqual([JSON.stringify(payload)]);
    });

    test('replays the last valid overlay to late-joining sockets', async () => {
        const session = makeSession();
        const first = await openSocket(session);

        const payload = {
            type: 'overlay',
            code: 'export const answer = 42;',
            sourceMap: { version: 3 },
        };

        first.server.emit('message', JSON.stringify(payload));

        const second = await openSocket(session);

        expect(second.server.sent).toEqual([JSON.stringify(payload)]);
    });

    test('ignores invalid JSON and non-overlay messages', async () => {
        const session = makeSession();
        const first = await openSocket(session);
        const second = await openSocket(session);

        first.server.emit('message', '{');
        first.server.emit('message', JSON.stringify({ type: 'bundle', bundle: 'noop' }));

        expect(first.server.sent).toEqual([]);
        expect(second.server.sent).toEqual([]);
    });

    test('keeps the last valid overlay when invalid messages arrive later', async () => {
        const session = makeSession();
        const first = await openSocket(session);

        const payload = {
            type: 'overlay',
            code: 'export default "persisted";',
        };

        first.server.emit('message', JSON.stringify(payload));
        first.server.emit('message', '{');
        first.server.emit('message', JSON.stringify({ type: 'bundle', bundle: 'noop' }));

        const lateJoiner = await openSocket(session);

        expect(lateJoiner.server.sent).toEqual([JSON.stringify(payload)]);
    });

    test('drops closed sockets from later broadcasts', async () => {
        const session = makeSession();
        const first = await openSocket(session);
        const second = await openSocket(session);

        second.server.close();
        first.server.emit(
            'message',
            JSON.stringify({
                type: 'overlay',
                code: 'export default 1;',
            }),
        );

        expect(second.server.sent).toEqual([]);
    });

    test('returns 404 for a non-upgrade request at /', async () => {
        const response = await makeSession().fetch(
            new Request('https://hmr-relay.dev.workers.dev/'),
        );

        expect(response.status).toBe(404);
        expect(await response.text()).toBe('hmr-relay: unknown route');
    });

    test('returns 404 for websocket upgrades on other paths', async () => {
        const response = await makeSession().fetch(
            new Request('https://hmr-relay.dev.workers.dev/overlay', {
                headers: { Upgrade: 'websocket' },
            }),
        );

        expect(response.status).toBe(404);
    });
});

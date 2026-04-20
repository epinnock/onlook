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

describe('HmrSession POST /push', () => {
    test('accepts a valid overlay and broadcasts to all connected sockets', async () => {
        const session = makeSession();
        const first = await openSocket(session);
        const second = await openSocket(session);

        const payload = {
            type: 'overlay',
            code: 'console.log("pushed");',
            sourceMap: { version: 3 },
        };

        const response = await session.fetch(
            new Request('https://hmr-relay.dev.workers.dev/push', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
            }),
        );

        expect(response.status).toBe(202);
        const body = (await response.json()) as { delivered: number };
        expect(body.delivered).toBe(2);
        // Unlike the WS-sourced broadcast (which excludes the sender socket),
        // HTTP push has no sender socket — every connected listener gets it.
        expect(first.server.sent).toEqual([JSON.stringify(payload)]);
        expect(second.server.sent).toEqual([JSON.stringify(payload)]);
    });

    test('persists the pushed overlay so late-joining sockets receive a replay', async () => {
        const session = makeSession();

        const payload = {
            type: 'overlay',
            code: 'export const pushed = true;',
        };

        const pushResponse = await session.fetch(
            new Request('https://hmr-relay.dev.workers.dev/push', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
            }),
        );
        expect(pushResponse.status).toBe(202);

        const lateJoiner = await openSocket(session);
        expect(lateJoiner.server.sent).toEqual([JSON.stringify(payload)]);
    });

    test('rejects malformed JSON with 400', async () => {
        const response = await makeSession().fetch(
            new Request('https://hmr-relay.dev.workers.dev/push', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: '{',
            }),
        );
        expect(response.status).toBe(400);
    });

    test('rejects non-overlay JSON with 400', async () => {
        const response = await makeSession().fetch(
            new Request('https://hmr-relay.dev.workers.dev/push', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ type: 'bundle', bundle: 'noop' }),
            }),
        );
        expect(response.status).toBe(400);
    });

    test('rejects non-JSON Content-Type with 415', async () => {
        const response = await makeSession().fetch(
            new Request('https://hmr-relay.dev.workers.dev/push', {
                method: 'POST',
                headers: { 'Content-Type': 'text/plain' },
                body: 'not json',
            }),
        );
        expect(response.status).toBe(415);
    });

    test('rejects missing Content-Type with 415', async () => {
        const response = await makeSession().fetch(
            new Request('https://hmr-relay.dev.workers.dev/push', {
                method: 'POST',
                body: '{}',
            }),
        );
        expect(response.status).toBe(415);
    });

    test('rejects bodies larger than 2 MiB with 413', async () => {
        const tooLarge = 'x'.repeat(2 * 1024 * 1024 + 1);
        const response = await makeSession().fetch(
            new Request('https://hmr-relay.dev.workers.dev/push', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ type: 'overlay', code: tooLarge }),
            }),
        );
        expect(response.status).toBe(413);
    });

    test('rejects declared Content-Length larger than 2 MiB with 413 before reading body', async () => {
        const response = await makeSession().fetch(
            new Request('https://hmr-relay.dev.workers.dev/push', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Content-Length': String(2 * 1024 * 1024 + 1),
                },
                body: '{}',
            }),
        );
        expect(response.status).toBe(413);
    });
});

describe('HmrSession durable storage persistence', () => {
    test('saveLastOverlayPayload writes to DurableObjectStorage so a fresh DO recovers it', async () => {
        const storage = new Map<string, unknown>();
        const storagePuts: Array<[string, unknown]> = [];
        const fakeStorage = {
            async get(key: string): Promise<unknown> {
                return storage.get(key) ?? null;
            },
            async put(key: string, value: unknown): Promise<void> {
                storagePuts.push([key, value]);
                storage.set(key, value);
            },
        };
        const state = {
            id: { name: 'hmr-sess-storage', toString: () => 'hmr-sess-storage' } as DurableObjectId,
            storage: fakeStorage,
        } as unknown as DurableObjectState;

        const firstInstance = new HmrSession(state, {});

        const payload = {
            type: 'overlay',
            code: 'export const persisted = true;',
        };

        const pushResp = await firstInstance.fetch(
            new Request('https://hmr-relay.dev.workers.dev/push', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
            }),
        );
        expect(pushResp.status).toBe(202);

        // Let the async storage.put settle (fire-and-forget path in prod).
        await new Promise((resolve) => setTimeout(resolve, 0));

        expect(storagePuts).toHaveLength(1);
        expect(storagePuts[0]![0]).toBe('last-overlay');
        expect(JSON.parse(storagePuts[0]![1] as string)).toEqual(payload);

        // Fresh DO instance — simulates the post-eviction reload path where
        // the in-memory `lastOverlayPayload` is undefined but storage.get
        // should surface the previously persisted payload to the late joiner.
        const freshInstance = new HmrSession(state, {});
        const pair = await openSocket(freshInstance);
        expect(pair.server.sent).toEqual([JSON.stringify(payload)]);
    });
});

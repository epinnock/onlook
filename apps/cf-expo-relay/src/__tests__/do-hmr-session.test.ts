/// <reference types="bun" />
import { beforeAll, describe, expect, mock, test } from 'bun:test';

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

beforeAll(async () => {
    const runtime = globalThis as typeof globalThis & { WebSocketPair?: unknown };

    if (typeof runtime.WebSocketPair !== 'function') {
        class MockWebSocket {
            accept(): void {}
        }

        class MockWebSocketPair {
            constructor() {
                Object.assign(this as object, {
                    0: new MockWebSocket(),
                    1: new MockWebSocket(),
                });
            }
        }

        Object.defineProperty(runtime, 'WebSocketPair', {
            configurable: true,
            writable: true,
            value: MockWebSocketPair,
        });
    }

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

describe('HmrSession Durable Object shell', () => {
    test('accepts a websocket upgrade at /', async () => {
        const response = await makeSession().fetch(
            new Request('https://hmr-relay.dev.workers.dev/', {
                headers: { Upgrade: 'websocket' },
            }),
        );

        expect(response.status).toBe(101);
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

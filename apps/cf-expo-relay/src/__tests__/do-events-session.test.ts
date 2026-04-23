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

type EventsSessionModule = typeof import('../do/events-session');

let EventsSession: EventsSessionModule['EventsSession'];

beforeAll(async () => {
    const mod: EventsSessionModule = await import('../do/events-session');
    EventsSession = mod.EventsSession;
});

function makeState(): DurableObjectState {
    return {
        id: {
            name: 'events-session-1',
            toString: () => 'events-session-1',
        } as DurableObjectId,
    } as DurableObjectState;
}

function makeSession(): InstanceType<EventsSessionModule['EventsSession']> {
    return new EventsSession(makeState(), {} as never);
}

async function push(
    session: InstanceType<EventsSessionModule['EventsSession']>,
    body: unknown,
): Promise<Response> {
    return await session.fetch(
        new Request('https://events-session/push', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        }),
    );
}

async function poll(
    session: InstanceType<EventsSessionModule['EventsSession']>,
    since: string | null,
): Promise<Response> {
    const url = new URL('https://events-session/poll');
    if (since !== null) url.searchParams.set('since', since);
    return await session.fetch(new Request(url.toString(), { method: 'GET' }));
}

type PollBody = { events: Array<{ id: string; type: string; data?: unknown }>; cursor?: string };

async function pollJson(
    session: InstanceType<EventsSessionModule['EventsSession']>,
    since: string | null,
): Promise<PollBody> {
    const res = await poll(session, since);
    return (await res.json()) as PollBody;
}

describe('EventsSession', () => {
    let originalNow: () => number;
    let mockNow = 0;

    beforeEach(() => {
        originalNow = Date.now;
        mockNow = 1_700_000_000_000;
        Date.now = () => mockNow;
    });

    afterEach(() => {
        Date.now = originalNow;
    });

    test('empty poll returns empty events + cursor "0"', async () => {
        const body = await pollJson(makeSession(), null);
        expect(body.events).toEqual([]);
        expect(body.cursor).toBe('0');
    });

    test('push then poll returns the pushed event', async () => {
        const session = makeSession();
        const res = await push(session, {
            type: 'overlayAck',
            data: { sessionId: 'sess', mountedAt: 1 },
        });
        expect(res.status).toBe(202);
        const { ok, cursor } = (await res.json()) as { ok: boolean; cursor: string };
        expect(ok).toBe(true);
        expect(cursor).toBe('1');

        const body = await pollJson(session, null);
        expect(body.events.length).toBe(1);
        expect(body.events[0]?.type).toBe('overlayAck');
        expect(body.cursor).toBe('1');
    });

    test('poll with since cursor filters already-seen events', async () => {
        const session = makeSession();
        await push(session, { type: 'a' });
        await push(session, { type: 'b' });
        await push(session, { type: 'c' });

        const body = await pollJson(session, '2');
        expect(body.events.map((e) => e.type)).toEqual(['c']);
        expect(body.cursor).toBe('3');
    });

    test('server-assigned id when push omits id', async () => {
        const session = makeSession();
        const res = await push(session, { type: 'ping' });
        const { id } = (await res.json()) as { id: string };
        expect(id).toBe('e-1');
        const body = await pollJson(session, null);
        expect(body.events[0]?.id).toBe('e-1');
    });

    test('explicit id round-trips', async () => {
        const session = makeSession();
        await push(session, { id: 'custom-xyz', type: 'ping' });
        const body = await pollJson(session, null);
        expect(body.events[0]?.id).toBe('custom-xyz');
    });

    test('invalid push body returns 400', async () => {
        const session = makeSession();
        const res = await session.fetch(
            new Request('https://events-session/push', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: 'not json',
            }),
        );
        expect(res.status).toBe(400);
    });

    test('push missing type returns 400', async () => {
        const session = makeSession();
        const res = await push(session, { data: {} });
        expect(res.status).toBe(400);
    });

    test('events older than TTL (10s) are pruned on poll', async () => {
        const session = makeSession();
        await push(session, { type: 'old' });
        mockNow += 11_000; // advance past EVENT_TTL_MS
        await push(session, { type: 'fresh' });
        const body = await pollJson(session, null);
        expect(body.events.map((e) => e.type)).toEqual(['fresh']);
    });

    test('ring buffer caps at 100 events (FIFO drop)', async () => {
        const session = makeSession();
        for (let i = 0; i < 110; i++) {
            await push(session, { type: `t-${i}` });
        }
        const body = await pollJson(session, null);
        expect(body.events.length).toBe(100);
        expect(body.events[0]?.type).toBe('t-10');
        expect(body.events[99]?.type).toBe('t-109');
    });

    test('idle poll past keepAlive interval synthesizes a keepAlive event', async () => {
        const session = makeSession();
        // First poll — no events, no keepAlive yet.
        const body1 = await pollJson(session, null);
        expect(body1.events).toEqual([]);
        // Advance 16s (past KEEPALIVE_INTERVAL_MS = 15s).
        mockNow += 16_000;
        const body2 = await pollJson(session, body1.cursor ?? '0');
        expect(body2.events.length).toBe(1);
        expect(body2.events[0]?.type).toBe('keepAlive');
    });

    test('idle polls within keepAlive window do NOT synthesize duplicates', async () => {
        const session = makeSession();
        await pollJson(session, null);
        mockNow += 16_000;
        const a = await pollJson(session, '0');
        expect(a.events.length).toBe(1);
        mockNow += 1_000; // still inside the next 15s window
        const b = await pollJson(session, a.cursor ?? '0');
        expect(b.events.length).toBe(0);
    });

    test('invalid since cursor returns 400', async () => {
        const session = makeSession();
        const res = await poll(session, 'not-a-number');
        expect(res.status).toBe(400);
    });

    test('unknown route returns 404', async () => {
        const session = makeSession();
        const res = await session.fetch(
            new Request('https://events-session/bogus', { method: 'GET' }),
        );
        expect(res.status).toBe(404);
    });
});

function afterEach(fn: () => void): void {
    // Bun:test has afterEach but not surfaced via the import above — bind it.
    // Using the same approach as pre-existing tests that reach into bun:test.
    const t = require('bun:test') as { afterEach: (fn: () => void) => void };
    t.afterEach(fn);
}

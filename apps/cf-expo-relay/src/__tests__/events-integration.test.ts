/// <reference types="bun" />
/**
 * Events channel cross-layer integration — stitches the route handlers in
 * `src/routes/events.ts` together with the `EventsSession` DurableObject so
 * the full push→poll cycle runs through both layers in one process.
 *
 * The existing suites test each layer in isolation:
 *   - `src/__tests__/routes/events.test.ts` tests route → stub DO
 *   - `src/__tests__/do-events-session.test.ts` tests DO direct fetch()
 *
 * This file replaces the stub with a real `EventsSession` instance so a
 * regression that only surfaces at the seam (e.g. route forwards to
 * wrong subpath) gets caught.
 */

import { beforeAll, beforeEach, describe, expect, test } from 'bun:test';

import { handleEventsPoll, handleEventsPush } from '../routes/events';
import type { Env } from '../env';

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

// mock.module has to be registered before the import site — rely on
// bun:test's module reset between files to keep the registration scoped.
import { mock } from 'bun:test';

type EventsSessionCtor = new (state: { id: DurableObjectId }, env: Env) => {
    fetch(req: Request): Promise<Response>;
};

let EventsSession: EventsSessionCtor;

beforeAll(async () => {
    const mod = await import('../do/events-session');
    EventsSession = mod.EventsSession as unknown as EventsSessionCtor;
});

/**
 * Build a minimal `EVENTS_SESSION` namespace binding that materialises real
 * EventsSession instances in memory, keyed by the `idFromName` string.
 */
function makeRealNamespace(): Env['EVENTS_SESSION'] {
    const instances = new Map<string, InstanceType<EventsSessionCtor>>();
    const get = (id: DurableObjectId): InstanceType<EventsSessionCtor> => {
        const key = String(id);
        let inst = instances.get(key);
        if (!inst) {
            inst = new EventsSession(
                {
                    id: { name: key, toString: () => key } as DurableObjectId,
                },
                {} as Env,
            );
            instances.set(key, inst);
        }
        return inst;
    };
    return {
        idFromName: (name: string) => ({ toString: () => `id(${name})` }) as DurableObjectId,
        get: (id: DurableObjectId) => get(id) as unknown as DurableObjectStub,
    } as unknown as Env['EVENTS_SESSION'];
}

function makeEnv(ns = makeRealNamespace()): Env {
    return {
        BUNDLES: {} as KVNamespace,
        EXPO_SESSION: {} as Env['EXPO_SESSION'],
        EVENTS_SESSION: ns,
        ESM_CACHE_URL: 'https://cf-esm-cache.dev.workers.dev',
    };
}

function req(
    pathname: string,
    query: Record<string, string> = {},
    method = 'GET',
    body?: object,
): Request {
    const url = new URL(`https://relay.dev.workers.dev${pathname}`);
    for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);
    const init: RequestInit = { method };
    if (body !== undefined) {
        init.body = JSON.stringify(body);
        init.headers = { 'Content-Type': 'application/json' };
    }
    return new Request(url.toString(), init);
}

type PollBody = { events: Array<{ id: string; type: string; data?: unknown }>; cursor?: string };

async function pushAck(
    env: Env,
    session: string,
    overrides: Record<string, unknown> = {},
): Promise<Response> {
    return handleEventsPush(
        req('/events/push', { session }, 'POST', {
            type: 'overlayAck',
            data: { sessionId: session, mountedAt: 1 },
            ...overrides,
        }),
        env,
    );
}

async function poll(env: Env, session: string, since = '0'): Promise<PollBody> {
    const res = await handleEventsPoll(req('/events', { session, since }), env);
    return (await res.json()) as PollBody;
}

describe('events route ↔ EventsSession DO integration', () => {
    let env: Env;
    let originalNow: () => number;
    let mockNow = 0;

    beforeEach(() => {
        env = makeEnv();
        originalNow = Date.now;
        mockNow = 1_700_000_000_000;
        Date.now = () => mockNow;
    });

    test('push via route then poll via route returns the event verbatim', async () => {
        const push = await pushAck(env, 'sess-int-1');
        expect(push.status).toBe(202);
        const body = await poll(env, 'sess-int-1');
        expect(body.events.length).toBe(1);
        expect(body.events[0]?.type).toBe('overlayAck');
        expect(body.cursor).toBe('1');
        Date.now = originalNow;
    });

    test('two different sessions do not cross-pollinate events', async () => {
        await pushAck(env, 'sess-A');
        await pushAck(env, 'sess-B');
        const a = await poll(env, 'sess-A');
        const b = await poll(env, 'sess-B');
        expect(a.events.length).toBe(1);
        expect(b.events.length).toBe(1);
        expect(a.events[0]?.id).toBe(b.events[0]?.id); // both assigned "e-1" locally
        // But they came from different DO instances — prove by pushing a
        // second event to A only and re-polling.
        await pushAck(env, 'sess-A', { type: 'keepAlive', data: { timestamp: 0 } });
        const a2 = await poll(env, 'sess-A', '0');
        const b2 = await poll(env, 'sess-B', '0');
        expect(a2.events.length).toBe(2);
        expect(b2.events.length).toBe(1); // unchanged
        Date.now = originalNow;
    });

    test('rapid push storm across 50 events preserves ordering + cursor', async () => {
        for (let i = 0; i < 50; i++) {
            await pushAck(env, 'sess-storm', {
                data: { sessionId: 'sess-storm', mountedAt: i },
            });
        }
        const body = await poll(env, 'sess-storm');
        expect(body.events.length).toBe(50);
        // First 50 — cursor should be "50"
        expect(body.cursor).toBe('50');
        // Assigned ids are "e-1".."e-50"
        expect(body.events[0]?.id).toBe('e-1');
        expect(body.events[49]?.id).toBe('e-50');
        Date.now = originalNow;
    });

    test('cursor-resume skips already-seen events', async () => {
        await pushAck(env, 'sess-resume', { data: { sessionId: 'sess-resume', mountedAt: 1 } });
        await pushAck(env, 'sess-resume', { data: { sessionId: 'sess-resume', mountedAt: 2 } });
        await pushAck(env, 'sess-resume', { data: { sessionId: 'sess-resume', mountedAt: 3 } });
        const first = await poll(env, 'sess-resume', '0');
        expect(first.events.length).toBe(3);
        expect(first.cursor).toBe('3');
        // Simulate a client that resumed from cursor 2 — should only see the third.
        const resumed = await poll(env, 'sess-resume', '2');
        expect(resumed.events.length).toBe(1);
        expect(resumed.events[0]?.data).toEqual({ sessionId: 'sess-resume', mountedAt: 3 });
        Date.now = originalNow;
    });

    test('idle poll past keepAlive window synthesizes keepAlive via the route path', async () => {
        // Initial poll advances lastKeepAliveAt to "now"
        await poll(env, 'sess-ka', '0');
        // Advance 16s — past 15s keepAlive interval
        mockNow += 16_000;
        const body = await poll(env, 'sess-ka', '0');
        expect(body.events.length).toBe(1);
        expect(body.events[0]?.type).toBe('keepAlive');
        Date.now = originalNow;
    });

    test('invalid session is rejected BEFORE reaching the DO', async () => {
        // The DO namespace get() should never be called for this case —
        // wrap get() in an assertion to prove it.
        let getCalled = false;
        const ns = {
            idFromName: () => ({}) as DurableObjectId,
            get: () => {
                getCalled = true;
                throw new Error('get() must not be called for invalid session');
            },
        } as unknown as Env['EVENTS_SESSION'];
        const badEnv = makeEnv(ns);
        const res = await handleEventsPoll(
            req('/events', { session: '<bad>' }),
            badEnv,
        );
        expect(res.status).toBe(400);
        expect(getCalled).toBe(false);
        Date.now = originalNow;
    });

    test('EVENTS_SESSION binding absent returns 503 without attempting a push', async () => {
        const noNs = makeEnv();
        delete (noNs as { EVENTS_SESSION?: unknown }).EVENTS_SESSION;
        const push = await pushAck(noNs, 'sess-x');
        expect(push.status).toBe(503);
        const pollRes = await handleEventsPoll(
            req('/events', { session: 'sess-x' }),
            noNs,
        );
        expect(pollRes.status).toBe(503);
        Date.now = originalNow;
    });
});

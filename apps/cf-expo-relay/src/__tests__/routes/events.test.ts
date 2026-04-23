/// <reference types="bun" />
import { describe, expect, mock, test } from 'bun:test';

import {
    EVENTS_POLL_ROUTE,
    EVENTS_PUSH_ROUTE,
    handleEventsPoll,
    handleEventsPush,
} from '../../routes/events';
import type { Env } from '../../env';

type DurableObjectStub = { fetch: (request: Request) => Promise<Response> };

function makeStubNs(
    capture: { lastUrl?: string; lastMethod?: string; lastBody?: string },
    respond: (request: Request) => Promise<Response>,
): Env['EVENTS_SESSION'] {
    const stub: DurableObjectStub = {
        async fetch(request: Request): Promise<Response> {
            capture.lastUrl = request.url;
            capture.lastMethod = request.method;
            capture.lastBody = await request.clone().text();
            return respond(request);
        },
    };
    return {
        idFromName: (name: string) => ({ toString: () => `id(${name})` }) as DurableObjectId,
        get: (_id: DurableObjectId) => stub as unknown as DurableObjectStub,
    } as unknown as Env['EVENTS_SESSION'];
}

function makeEnv(ns?: Env['EVENTS_SESSION']): Env {
    return {
        BUNDLES: {} as KVNamespace,
        EXPO_SESSION: {} as Env['EXPO_SESSION'],
        EVENTS_SESSION: ns,
        ESM_CACHE_URL: 'https://cf-esm-cache.dev.workers.dev',
    };
}

function req(pathname: string, query: Record<string, string> = {}, method = 'GET', body?: string): Request {
    const url = new URL(`https://relay.dev.workers.dev${pathname}`);
    for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);
    const init: RequestInit = { method };
    if (body !== undefined) {
        init.body = body;
        init.headers = { 'Content-Type': 'application/json' };
    }
    return new Request(url.toString(), init);
}

describe('route regexes', () => {
    test('EVENTS_POLL_ROUTE matches /events', () => {
        expect(EVENTS_POLL_ROUTE.test('/events')).toBe(true);
        expect(EVENTS_POLL_ROUTE.test('/events/push')).toBe(false);
    });

    test('EVENTS_PUSH_ROUTE matches /events/push', () => {
        expect(EVENTS_PUSH_ROUTE.test('/events/push')).toBe(true);
        expect(EVENTS_PUSH_ROUTE.test('/events')).toBe(false);
    });
});

describe('handleEventsPoll', () => {
    test('returns 503 when EVENTS_SESSION binding is missing', async () => {
        const res = await handleEventsPoll(req('/events', { session: 's' }), makeEnv());
        expect(res.status).toBe(503);
    });

    test('returns 400 when session param is missing', async () => {
        const ns = makeStubNs(
            {},
            async () => new Response('{"events":[]}', { status: 200 }),
        );
        const res = await handleEventsPoll(req('/events', {}), makeEnv(ns));
        expect(res.status).toBe(400);
    });

    test('returns 400 when session contains invalid chars', async () => {
        const ns = makeStubNs(
            {},
            async () => new Response('{}', { status: 200 }),
        );
        const res = await handleEventsPoll(req('/events', { session: 'bad session!' }), makeEnv(ns));
        expect(res.status).toBe(400);
    });

    test('returns 405 on non-GET', async () => {
        const ns = makeStubNs({}, async () => new Response('{}'));
        const res = await handleEventsPoll(req('/events', { session: 's' }, 'POST'), makeEnv(ns));
        expect(res.status).toBe(405);
    });

    test('forwards GET /poll?since=<cursor> to the DO and returns its body', async () => {
        const capture: { lastUrl?: string; lastMethod?: string } = {};
        const ns = makeStubNs(capture, async () =>
            new Response('{"events":[],"cursor":"c1"}', {
                status: 200,
                headers: { 'Content-Type': 'application/json' },
            }),
        );
        const res = await handleEventsPoll(
            req('/events', { session: 'sess-1', since: '42' }),
            makeEnv(ns),
        );
        expect(res.status).toBe(200);
        expect(capture.lastMethod).toBe('GET');
        expect(capture.lastUrl).toContain('/poll');
        expect(capture.lastUrl).toContain('since=42');
        const body = (await res.json()) as { cursor?: string };
        expect(body.cursor).toBe('c1');
    });

    test('defaults since to "0" when not supplied', async () => {
        const capture: { lastUrl?: string } = {};
        const ns = makeStubNs(capture, async () =>
            new Response('{"events":[],"cursor":"0"}', { status: 200 }),
        );
        await handleEventsPoll(req('/events', { session: 's' }), makeEnv(ns));
        expect(capture.lastUrl).toContain('since=0');
    });
});

describe('handleEventsPush', () => {
    test('returns 503 when EVENTS_SESSION binding is missing', async () => {
        const res = await handleEventsPush(
            req('/events/push', { session: 's' }, 'POST', '{"type":"x"}'),
            makeEnv(),
        );
        expect(res.status).toBe(503);
    });

    test('returns 400 when session param is invalid', async () => {
        const ns = makeStubNs({}, async () => new Response('{}'));
        const res = await handleEventsPush(
            req('/events/push', { session: '<bad>' }, 'POST', '{}'),
            makeEnv(ns),
        );
        expect(res.status).toBe(400);
    });

    test('returns 405 on non-POST', async () => {
        const ns = makeStubNs({}, async () => new Response('{}'));
        const res = await handleEventsPush(req('/events/push', { session: 's' }, 'GET'), makeEnv(ns));
        expect(res.status).toBe(405);
    });

    test('forwards POST /push body verbatim to the DO', async () => {
        const capture: { lastMethod?: string; lastBody?: string } = {};
        const ns = makeStubNs(capture, async () =>
            new Response('{"ok":true,"id":"e-1","cursor":"1"}', {
                status: 202,
                headers: { 'Content-Type': 'application/json' },
            }),
        );
        const body = JSON.stringify({
            type: 'overlayAck',
            data: { sessionId: 'sess', mountedAt: 1 },
        });
        const res = await handleEventsPush(
            req('/events/push', { session: 'sess' }, 'POST', body),
            makeEnv(ns),
        );
        expect(res.status).toBe(202);
        expect(capture.lastMethod).toBe('POST');
        expect(capture.lastBody).toBe(body);
    });
});

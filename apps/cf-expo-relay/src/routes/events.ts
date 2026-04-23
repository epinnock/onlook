import type { Env } from '../env';

/**
 * `GET /events?session=<id>&since=<cursor>` — poll-based phone→editor event
 * channel. Forwards the request to the per-session EventsSession Durable
 * Object at `/poll`.
 *
 * `POST /events/push?session=<id>` — editor publishes an event. Forwards
 * to the DO at `/push`.
 *
 * Wire contract: `plans/adr/cf-expo-relay-events-channel.md`. Response
 * bodies match `RelayEventsResponseSchema` in
 * `packages/mobile-client-protocol/src/relay-events.ts`.
 */

const SESSION_ID = /^[A-Za-z0-9_-]{1,128}$/;

export const EVENTS_POLL_ROUTE = /^\/events$/;
export const EVENTS_PUSH_ROUTE = /^\/events\/push$/;

export async function handleEventsPoll(request: Request, env: Env): Promise<Response> {
    if (request.method !== 'GET') {
        return plain('events: method not allowed', 405);
    }
    const ns = env.EVENTS_SESSION;
    if (!ns) {
        return plain('events: EVENTS_SESSION binding missing', 503);
    }
    const url = new URL(request.url);
    const session = url.searchParams.get('session');
    if (session === null || !SESSION_ID.test(session)) {
        return plain('events: invalid or missing session', 400);
    }
    const since = url.searchParams.get('since') ?? '0';
    const stub = ns.get(ns.idFromName(session));
    const subUrl = new URL('https://events-session/poll');
    subUrl.searchParams.set('since', since);
    return await stub.fetch(new Request(subUrl.toString(), { method: 'GET' }));
}

export async function handleEventsPush(request: Request, env: Env): Promise<Response> {
    if (request.method !== 'POST') {
        return plain('events: method not allowed', 405);
    }
    const ns = env.EVENTS_SESSION;
    if (!ns) {
        return plain('events: EVENTS_SESSION binding missing', 503);
    }
    const url = new URL(request.url);
    const session = url.searchParams.get('session');
    if (session === null || !SESSION_ID.test(session)) {
        return plain('events: invalid or missing session', 400);
    }
    const body = await request.text();
    const stub = ns.get(ns.idFromName(session));
    return await stub.fetch(
        new Request('https://events-session/push', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body,
        }),
    );
}

function plain(message: string, status: number): Response {
    return new Response(message, { status });
}

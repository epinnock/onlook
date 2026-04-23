import { DurableObject } from 'cloudflare:workers';

import type { Env } from '../env';

/**
 * EventsSession — per-session Durable Object backing the `/events` poll
 * channel. Serves as the bridgeless-safe replacement for WebSocket onopen
 * dispatch (ADR `v2-pipeline-validation-findings.md` finding #8).
 *
 * Wire contract: `plans/adr/cf-expo-relay-events-channel.md`. Clients poll
 * `GET /events?session=<id>&since=<cursor>` via worker-level routing; the
 * worker forwards the subpath to this DO. Internally we expose:
 *
 *   GET  /poll?since=<cursor>    — consumer fetches events newer than cursor
 *   POST /push                   — publisher appends an event (typed body)
 *
 * Both paths return JSON matching `RelayEventsResponseSchema` for poll, and
 * `{ ok: true, id, cursor }` for push.
 *
 * State model (in-memory, re-initialized on DO cold start — event history
 * is intentionally transient):
 *   events        — chronologically-ordered queue. Capped at MAX_EVENTS
 *                   (100); oldest events drop as new ones arrive.
 *   cursor        — monotonic integer, incremented on every push.
 *   lastPushAt    — ms timestamp of the last non-keepAlive event; drives
 *                   on-demand keepAlive synthesis during idle polls.
 *
 * Retention: events older than EVENT_TTL_MS (10s) are pruned on every
 * poll, so a client that lags too long gets an empty window rather than
 * stale replay.
 */

const MAX_EVENTS = 100;
const EVENT_TTL_MS = 10_000;
const KEEPALIVE_INTERVAL_MS = 15_000;

type InternalEvent = {
    cursor: number;
    event: {
        id: string;
        type: string;
        data: unknown;
    };
    pushedAt: number;
};

type EventsSessionStorage = Pick<DurableObjectStorage, 'get' | 'put'>;

export class EventsSession extends DurableObject<Env> {
    private events: InternalEvent[] = [];
    private cursor = 0;
    private lastPushAt = 0;
    private lastKeepAliveAt: number;
    private readonly storage: EventsSessionStorage | null;

    constructor(state: DurableObjectState, env: Env) {
        super(state, env);
        const storage = (state as DurableObjectState & { storage?: EventsSessionStorage }).storage;
        this.storage = storage ?? null;
        // Seed with current time so the first idle poll inside the 15 s
        // window does not synthesise a keepAlive — clients expect the
        // keepAlive to appear only after genuine idle, not at t=0.
        this.lastKeepAliveAt = Date.now();
    }

    override async fetch(request: Request): Promise<Response> {
        const url = new URL(request.url);
        if (request.method === 'GET' && url.pathname === '/poll') {
            return this.handlePoll(url);
        }
        if (request.method === 'POST' && url.pathname === '/push') {
            return await this.handlePush(request);
        }
        return new Response('events-session: unknown route', { status: 404 });
    }

    private handlePoll(url: URL): Response {
        this.pruneExpired();
        const sinceRaw = url.searchParams.get('since');
        const since = sinceRaw === null ? 0 : Number(sinceRaw);
        if (!Number.isFinite(since) || since < 0) {
            return jsonResponse({ error: 'invalid since cursor' }, 400);
        }
        const events = this.events.filter((e) => e.cursor > since).map((e) => e.event);
        this.maybeAppendKeepAlive(events);
        const cursor = this.events.length === 0 ? this.cursor : this.events[this.events.length - 1]!.cursor;
        return jsonResponse({
            events,
            cursor: String(cursor),
        });
    }

    private maybeAppendKeepAlive(toSend: InternalEvent['event'][]): void {
        if (toSend.length > 0) return;
        const now = Date.now();
        if (now - this.lastKeepAliveAt < KEEPALIVE_INTERVAL_MS) return;
        this.lastKeepAliveAt = now;
        const ka: InternalEvent = {
            cursor: ++this.cursor,
            event: {
                id: `ka-${this.cursor}`,
                type: 'keepAlive',
                data: { timestamp: now },
            },
            pushedAt: now,
        };
        this.events.push(ka);
        this.capTo(MAX_EVENTS);
        toSend.push(ka.event);
    }

    private async handlePush(request: Request): Promise<Response> {
        let body: unknown;
        try {
            body = await request.json();
        } catch {
            return jsonResponse({ error: 'invalid JSON body' }, 400);
        }
        if (!body || typeof body !== 'object') {
            return jsonResponse({ error: 'body must be an object' }, 400);
        }
        const bodyRec = body as Record<string, unknown>;
        const type = bodyRec['type'];
        if (typeof type !== 'string' || type.length === 0) {
            return jsonResponse({ error: 'type is required' }, 400);
        }
        const dataField = 'data' in bodyRec ? bodyRec['data'] : undefined;
        const idField = bodyRec['id'];
        const id = typeof idField === 'string' && idField.length > 0 ? idField : `e-${this.cursor + 1}`;
        this.lastPushAt = Date.now();
        const internal: InternalEvent = {
            cursor: ++this.cursor,
            event: { id, type, data: dataField },
            pushedAt: this.lastPushAt,
        };
        this.events.push(internal);
        this.capTo(MAX_EVENTS);
        return jsonResponse({ ok: true, id, cursor: String(internal.cursor) }, 202);
    }

    private pruneExpired(): void {
        const now = Date.now();
        const cutoff = now - EVENT_TTL_MS;
        let i = 0;
        while (i < this.events.length && this.events[i]!.pushedAt < cutoff) {
            i += 1;
        }
        if (i > 0) this.events.splice(0, i);
    }

    private capTo(max: number): void {
        if (this.events.length > max) {
            this.events.splice(0, this.events.length - max);
        }
    }

    /** @internal Test-only accessors for deterministic assertions. */
    _getState(): { cursor: number; eventCount: number; lastPushAt: number } {
        return { cursor: this.cursor, eventCount: this.events.length, lastPushAt: this.lastPushAt };
    }
}

function jsonResponse(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json' },
    });
}

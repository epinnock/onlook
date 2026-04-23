/**
 * Poll-based replacement for the bridgeless-WebSocket relay-event channel.
 *
 * Background: in bridgeless iOS 18.6 `WebSocket.onopen` / `onmessage` don't
 * dispatch to JS (ADR `v2-pipeline-validation-findings.md` finding #8), so
 * the phone→editor event path (OverlayAck, bundleUpdate) cannot use WS in
 * the usual way. `OnlookRuntime.httpGet` (synchronous JSI → NSURLSession)
 * is already the documented workaround for manifest + bundle fetches — this
 * module applies the same pattern to an events endpoint.
 *
 * Contract: the relay exposes `GET <relayHost>/events?session=<id>&since=<cursor>`
 * returning `{ events: Array<{id, type, data}>, cursor: string }`. The poll
 * advances `cursor` after every successful response, and only dispatches
 * events whose id is not already in the seen-Set (defence against the relay
 * echoing the same payload on cursor-edge cases).
 *
 * All I/O is injected — `httpGet`, `setTimeout`, `clearTimeout` — so the
 * loop can be exercised deterministically from bun:test without touching
 * the real runtime.
 */

export type HttpGetResult = {
    ok: boolean;
    status: number;
    body: string;
    contentType: string;
    error?: string;
};

export type HttpGetFn = (
    url: string,
    headers?: Record<string, string>,
) => HttpGetResult;

export type RelayEvent = {
    id: string;
    type: string;
    data: unknown;
};

export type RelayEventsResponse = {
    events: RelayEvent[];
    cursor?: string;
};

export type RelayEventPollOptions = {
    relayHost: string;
    sessionId: string;
    httpGet: HttpGetFn;
    onEvent: (event: RelayEvent) => void;
    pollIntervalMs?: number;
    onError?: (error: Error) => void;
    setTimeout?: (fn: () => void, ms: number) => unknown;
    clearTimeout?: (handle: unknown) => void;
};

export type RelayEventPollHandle = {
    stop: () => void;
    getCursor: () => string | undefined;
    getSeenCount: () => number;
};

const DEFAULT_POLL_MS = 1000;

function buildUrl(relayHost: string, sessionId: string, cursor: string | undefined): string {
    const separator = relayHost.includes('?') ? '&' : '?';
    const cursorParam = cursor ? `&since=${encodeURIComponent(cursor)}` : '';
    return `${relayHost}${separator}session=${encodeURIComponent(sessionId)}${cursorParam}`;
}

function parseResponse(body: string): RelayEventsResponse {
    const parsed: unknown = JSON.parse(body);
    if (!parsed || typeof parsed !== 'object') {
        throw new Error('relay events response: not an object');
    }
    const rec = parsed as { events?: unknown; cursor?: unknown };
    if (!Array.isArray(rec.events)) {
        throw new Error('relay events response: missing events array');
    }
    const events: RelayEvent[] = [];
    for (const raw of rec.events) {
        if (!raw || typeof raw !== 'object') continue;
        const e = raw as { id?: unknown; type?: unknown; data?: unknown };
        if (typeof e.id !== 'string' || typeof e.type !== 'string') continue;
        events.push({ id: e.id, type: e.type, data: e.data });
    }
    return { events, cursor: typeof rec.cursor === 'string' ? rec.cursor : undefined };
}

export function startRelayEventPoll(
    opts: RelayEventPollOptions,
): RelayEventPollHandle {
    const pollIntervalMs = opts.pollIntervalMs ?? DEFAULT_POLL_MS;
    const setTimeoutFn =
        opts.setTimeout ?? (globalThis.setTimeout as unknown as RelayEventPollOptions['setTimeout'])!;
    const clearTimeoutFn =
        opts.clearTimeout ??
        (globalThis.clearTimeout as unknown as RelayEventPollOptions['clearTimeout'])!;

    let cursor: string | undefined;
    const seen = new Set<string>();
    let stopped = false;
    let pendingTimer: unknown = undefined;

    const tick = (): void => {
        if (stopped) return;
        const url = buildUrl(opts.relayHost, opts.sessionId, cursor);
        let result: HttpGetResult;
        try {
            result = opts.httpGet(url, {});
        } catch (err) {
            opts.onError?.(err instanceof Error ? err : new Error(String(err)));
            scheduleNext();
            return;
        }
        if (result.error) {
            opts.onError?.(new Error(result.error));
            scheduleNext();
            return;
        }
        if (!result.ok) {
            opts.onError?.(new Error(`relay events HTTP ${result.status}`));
            scheduleNext();
            return;
        }
        let response: RelayEventsResponse;
        try {
            response = parseResponse(result.body);
        } catch (err) {
            opts.onError?.(err instanceof Error ? err : new Error(String(err)));
            scheduleNext();
            return;
        }
        for (const event of response.events) {
            if (seen.has(event.id)) continue;
            seen.add(event.id);
            try {
                opts.onEvent(event);
            } catch (err) {
                opts.onError?.(err instanceof Error ? err : new Error(String(err)));
            }
        }
        if (response.cursor !== undefined) {
            cursor = response.cursor;
        }
        scheduleNext();
    };

    const scheduleNext = (): void => {
        if (stopped) return;
        pendingTimer = setTimeoutFn!(tick, pollIntervalMs);
    };

    // Kick off the first poll immediately.
    tick();

    return {
        stop: () => {
            if (stopped) return;
            stopped = true;
            if (pendingTimer !== undefined) {
                clearTimeoutFn!(pendingTimer);
                pendingTimer = undefined;
            }
        },
        getCursor: () => cursor,
        getSeenCount: () => seen.size,
    };
}

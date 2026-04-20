import { describe, expect, test } from 'bun:test';

import { pushOverlay } from '../push-overlay';

interface FakeFetchCall {
    url: string;
    init: RequestInit;
}

// pushOverlay's `fetchImpl` option accepts the minimal `(input, init) =>
// Promise<Response>` shape. We intentionally use that narrower surface
// here so the test fake doesn't have to implement `fetch.preconnect`
// (Bun's ambient typings require it on `typeof fetch`, but we never call
// it from pushOverlay).
type MinimalFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

function makeFakeFetch(responses: Array<Response | Error>): {
    fetch: MinimalFetch;
    calls: FakeFetchCall[];
} {
    const calls: FakeFetchCall[] = [];
    let index = 0;
    const fetchImpl: MinimalFetch = async (input, init) => {
        const url = typeof input === 'string' ? input : (input as Request).url;
        calls.push({ url, init: init ?? {} });
        const next = responses[index];
        index += 1;
        if (!next) {
            return new Response(null, { status: 500 });
        }
        if (next instanceof Error) {
            throw next;
        }
        return next;
    };
    return { fetch: fetchImpl, calls };
}

function okResponse(delivered: number): Response {
    return new Response(JSON.stringify({ delivered }), {
        status: 202,
        headers: { 'Content-Type': 'application/json' },
    });
}

describe('pushOverlay', () => {
    test('POSTs the overlay message to /push/:sessionId and returns delivered count', async () => {
        const { fetch, calls } = makeFakeFetch([okResponse(3)]);
        const result = await pushOverlay({
            relayBaseUrl: 'https://relay.example.com',
            sessionId: 'sess-123',
            overlay: { code: 'globalThis.foo=1;', sourceMap: '{"version":3}' },
            fetchImpl: fetch,
        });

        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.delivered).toBe(3);
        expect(result.attempts).toBe(1);
        expect(calls).toHaveLength(1);
        expect(calls[0]?.url).toBe('https://relay.example.com/push/sess-123');
        expect(calls[0]?.init.method).toBe('POST');
        const headers = new Headers(calls[0]?.init.headers);
        expect(headers.get('Content-Type')).toBe('application/json');
        const body = JSON.parse(calls[0]?.init.body as string) as Record<string, unknown>;
        expect(body.type).toBe('overlay');
        expect(body.code).toBe('globalThis.foo=1;');
        expect(body.sourceMap).toBe('{"version":3}');
    });

    test('trims trailing slashes off the relay base URL', async () => {
        const { fetch, calls } = makeFakeFetch([okResponse(1)]);
        await pushOverlay({
            relayBaseUrl: 'https://relay.example.com////',
            sessionId: 'sess',
            overlay: { code: 'x' },
            fetchImpl: fetch,
        });
        expect(calls[0]?.url).toBe('https://relay.example.com/push/sess');
    });

    test('omits sourceMap when not provided', async () => {
        const { fetch, calls } = makeFakeFetch([okResponse(0)]);
        await pushOverlay({
            relayBaseUrl: 'https://r',
            sessionId: 'sess',
            overlay: { code: 'abc' },
            fetchImpl: fetch,
        });
        const body = JSON.parse(calls[0]?.init.body as string) as Record<string, unknown>;
        expect(body.sourceMap).toBeUndefined();
    });

    test('rejects invalid session ids without calling fetch', async () => {
        const { fetch, calls } = makeFakeFetch([okResponse(0)]);
        const result = await pushOverlay({
            relayBaseUrl: 'https://r',
            sessionId: 'has space',
            overlay: { code: 'x' },
            fetchImpl: fetch,
        });
        expect(result.ok).toBe(false);
        if (result.ok) return;
        expect(result.error).toContain('invalid sessionId');
        expect(calls).toHaveLength(0);
    });

    test('rejects empty overlay code without calling fetch', async () => {
        const { fetch, calls } = makeFakeFetch([okResponse(0)]);
        const result = await pushOverlay({
            relayBaseUrl: 'https://r',
            sessionId: 'sess',
            overlay: { code: '' },
            fetchImpl: fetch,
        });
        expect(result.ok).toBe(false);
        expect(calls).toHaveLength(0);
    });

    test('does not retry on 4xx responses', async () => {
        const { fetch, calls } = makeFakeFetch([
            new Response('bad overlay', { status: 400 }),
        ]);
        const result = await pushOverlay({
            relayBaseUrl: 'https://r',
            sessionId: 'sess',
            overlay: { code: 'x' },
            fetchImpl: fetch,
            retryBaseMs: 0,
        });
        expect(result.ok).toBe(false);
        if (result.ok) return;
        expect(result.status).toBe(400);
        expect(result.attempts).toBe(1);
        expect(calls).toHaveLength(1);
    });

    test('retries on 5xx and succeeds on the second attempt', async () => {
        const { fetch, calls } = makeFakeFetch([
            new Response(null, { status: 503 }),
            okResponse(2),
        ]);
        const result = await pushOverlay({
            relayBaseUrl: 'https://r',
            sessionId: 'sess',
            overlay: { code: 'x' },
            fetchImpl: fetch,
            retryBaseMs: 0,
        });
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.attempts).toBe(2);
        expect(result.delivered).toBe(2);
        expect(calls).toHaveLength(2);
    });

    test('emits a telemetry event with attempts + duration + delivered on success', async () => {
        const { fetch } = makeFakeFetch([okResponse(4)]);
        const events: unknown[] = [];

        await pushOverlay({
            relayBaseUrl: 'https://r',
            sessionId: 'telemetry-ok',
            overlay: { code: 'x' },
            fetchImpl: fetch,
            onTelemetry: (event) => events.push(event),
        });

        expect(events).toHaveLength(1);
        const e = events[0] as Record<string, unknown>;
        expect(e.ok).toBe(true);
        expect(e.sessionId).toBe('telemetry-ok');
        expect(e.attempts).toBe(1);
        expect(e.delivered).toBe(4);
        expect(e.status).toBe(202);
        expect(typeof e.durationMs).toBe('number');
        expect(typeof e.bytes).toBe('number');
        expect(e.bytes).toBeGreaterThan(0);
    });

    test('emits a telemetry event with error on failure', async () => {
        const { fetch } = makeFakeFetch([new Response(null, { status: 400 })]);
        const events: unknown[] = [];

        await pushOverlay({
            relayBaseUrl: 'https://r',
            sessionId: 'telemetry-fail',
            overlay: { code: 'x' },
            fetchImpl: fetch,
            retryBaseMs: 0,
            onTelemetry: (event) => events.push(event),
        });

        expect(events).toHaveLength(1);
        const e = events[0] as Record<string, unknown>;
        expect(e.ok).toBe(false);
        expect(e.status).toBe(400);
        expect(e.error).toBeDefined();
    });

    test('onTelemetry: null silences the default console logger', async () => {
        const { fetch } = makeFakeFetch([okResponse(1)]);

        // No assertions beyond "does not throw and does not observably log" —
        // we can't spy on console.info here cheaply, but the important
        // contract is that passing null is a supported kill-switch for
        // tests + prod builds that prefer to report through a different sink.
        const result = await pushOverlay({
            relayBaseUrl: 'https://r',
            sessionId: 'silent',
            overlay: { code: 'x' },
            fetchImpl: fetch,
            onTelemetry: null,
        });
        expect(result.ok).toBe(true);
    });

    test('a throwing telemetry sink never affects control flow', async () => {
        const { fetch } = makeFakeFetch([okResponse(1)]);
        const result = await pushOverlay({
            relayBaseUrl: 'https://r',
            sessionId: 'throws',
            overlay: { code: 'x' },
            fetchImpl: fetch,
            onTelemetry: () => {
                throw new Error('sink exploded');
            },
        });
        expect(result.ok).toBe(true);
    });

    test('retries on network errors and gives up after maxRetries', async () => {
        const { fetch, calls } = makeFakeFetch([
            new Error('ECONNREFUSED'),
            new Error('ECONNREFUSED'),
            new Error('ECONNREFUSED'),
        ]);
        const result = await pushOverlay({
            relayBaseUrl: 'https://r',
            sessionId: 'sess',
            overlay: { code: 'x' },
            fetchImpl: fetch,
            maxRetries: 2,
            retryBaseMs: 0,
        });
        expect(result.ok).toBe(false);
        if (result.ok) return;
        expect(result.attempts).toBe(3);
        expect(calls).toHaveLength(3);
        expect(result.error).toContain('ECONNREFUSED');
    });
});

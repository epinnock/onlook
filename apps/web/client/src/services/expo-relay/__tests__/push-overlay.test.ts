import { describe, expect, test } from 'bun:test';

import {
    OverlayUpdateMessageSchema,
    type OverlayAssetManifest,
} from '@onlook/mobile-client-protocol';

import { pushOverlay, pushOverlayV1, type PushOverlayTelemetry } from '../push-overlay';

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

// ─── pushOverlayV1 (ABI v1 — two-tier-overlay-v2 task #78) ───────────────────

describe('pushOverlayV1', () => {
    test('POSTs an OverlayUpdateMessage and returns delivered count', async () => {
        const { fetch, calls } = makeFakeFetch([okResponse(2)]);
        const result = await pushOverlayV1({
            relayBaseUrl: 'https://relay.example.com',
            sessionId: 'sess-v1',
            overlay: { code: 'module.exports = { default: 1 };', buildDurationMs: 37 },
            fetchImpl: fetch,
            onTelemetry: null,
        });
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.delivered).toBe(2);
        expect(calls).toHaveLength(1);
        expect(calls[0]?.url).toBe('https://relay.example.com/push/sess-v1');
        const body = JSON.parse(calls[0]?.init.body as string) as Record<string, unknown>;
        expect(body.type).toBe('overlayUpdate');
        expect(body.abi).toBe('v1');
        expect(body.sessionId).toBe('sess-v1');
        expect(body.source).toBe('module.exports = { default: 1 };');
        expect(body.assets).toEqual({ abi: 'v1', assets: {} });
        const meta = body.meta as Record<string, unknown>;
        expect(meta.entryModule).toBe(0);
        expect(meta.buildDurationMs).toBe(37);
        expect(typeof meta.overlayHash).toBe('string');
        expect((meta.overlayHash as string).length).toBe(64); // sha256 hex
    });

    test('overlayHash is stable for the same source bytes', async () => {
        const { fetch } = makeFakeFetch([okResponse(0), okResponse(0)]);
        const body = 'module.exports = { default: "A" };';
        const overlay = { code: body, buildDurationMs: 10 };
        const { fetch: f1, calls: c1 } = makeFakeFetch([okResponse(0)]);
        const { fetch: f2, calls: c2 } = makeFakeFetch([okResponse(0)]);
        await pushOverlayV1({
            relayBaseUrl: 'https://r',
            sessionId: 's',
            overlay,
            fetchImpl: f1,
            onTelemetry: null,
        });
        await pushOverlayV1({
            relayBaseUrl: 'https://r',
            sessionId: 's',
            overlay,
            fetchImpl: f2,
            onTelemetry: null,
        });
        const h1 = (JSON.parse(c1[0]!.init.body as string).meta as Record<string, unknown>)
            .overlayHash as string;
        const h2 = (JSON.parse(c2[0]!.init.body as string).meta as Record<string, unknown>)
            .overlayHash as string;
        expect(h1).toBe(h2);
        // Silence unused-var lint on the outer `fetch`.
        void fetch;
    });

    test('includes a non-empty asset manifest when provided', async () => {
        const { fetch, calls } = makeFakeFetch([okResponse(1)]);
        const assets: OverlayAssetManifest = {
            abi: 'v1',
            assets: {
                ab12: {
                    kind: 'image',
                    hash: 'ab12',
                    mime: 'image/png',
                    uri: 'https://r2/overlays/ab12.png',
                    width: 64,
                    height: 64,
                },
            },
        };
        await pushOverlayV1({
            relayBaseUrl: 'https://r',
            sessionId: 's',
            overlay: { code: 'x', buildDurationMs: 0 },
            assets,
            fetchImpl: fetch,
            onTelemetry: null,
        });
        const body = JSON.parse(calls[0]!.init.body as string) as Record<string, unknown>;
        expect(body.assets).toEqual(assets);
    });

    test('produces a message that validates against OverlayUpdateMessageSchema', async () => {
        const { fetch, calls } = makeFakeFetch([okResponse(0)]);
        await pushOverlayV1({
            relayBaseUrl: 'https://r',
            sessionId: 's',
            overlay: { code: 'module.exports = {};', buildDurationMs: 5 },
            fetchImpl: fetch,
            onTelemetry: null,
        });
        const body = JSON.parse(calls[0]!.init.body as string);
        expect(() => OverlayUpdateMessageSchema.parse(body)).not.toThrow();
    });

    test('rejects invalid sessionId without hitting the network', async () => {
        const { fetch, calls } = makeFakeFetch([]);
        const result = await pushOverlayV1({
            relayBaseUrl: 'https://r',
            sessionId: 'bad session!',
            overlay: { code: 'x', buildDurationMs: 0 },
            fetchImpl: fetch,
            onTelemetry: null,
        });
        expect(result.ok).toBe(false);
        expect(calls).toHaveLength(0);
    });

    test('rejects empty overlay code without hitting the network', async () => {
        const { fetch, calls } = makeFakeFetch([]);
        const result = await pushOverlayV1({
            relayBaseUrl: 'https://r',
            sessionId: 'sess',
            overlay: { code: '', buildDurationMs: 0 },
            fetchImpl: fetch,
            onTelemetry: null,
        });
        expect(result.ok).toBe(false);
        expect(calls).toHaveLength(0);
    });

    test('retries on 5xx and succeeds on second attempt', async () => {
        const { fetch, calls } = makeFakeFetch([
            new Response(null, { status: 503 }),
            okResponse(1),
        ]);
        const result = await pushOverlayV1({
            relayBaseUrl: 'https://r',
            sessionId: 'sess',
            overlay: { code: 'x', buildDurationMs: 0 },
            fetchImpl: fetch,
            retryBaseMs: 0,
            onTelemetry: null,
        });
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.attempts).toBe(2);
        expect(calls).toHaveLength(2);
    });

    test('does not retry on 4xx', async () => {
        const { fetch, calls } = makeFakeFetch([
            new Response('bad request', { status: 400 }),
        ]);
        const result = await pushOverlayV1({
            relayBaseUrl: 'https://r',
            sessionId: 'sess',
            overlay: { code: 'x', buildDurationMs: 0 },
            fetchImpl: fetch,
            retryBaseMs: 0,
            onTelemetry: null,
        });
        expect(result.ok).toBe(false);
        if (result.ok) return;
        expect(result.status).toBe(400);
        expect(calls).toHaveLength(1);
    });

    // Phase 11b safety gate — pre-flip work; see ADR-0009.
    describe('compatibility gate', () => {
        test('proceeds when gate returns "ok"', async () => {
            const { fetch, calls } = makeFakeFetch([okResponse(1)]);
            const result = await pushOverlayV1({
                relayBaseUrl: 'https://r',
                sessionId: 's',
                overlay: { code: 'm', buildDurationMs: 0 },
                fetchImpl: fetch,
                onTelemetry: null,
                compatibility: () => 'ok',
            });
            expect(result.ok).toBe(true);
            expect(calls).toHaveLength(1);
        });

        test('fails-closed when gate returns "unknown" — no network call', async () => {
            const { fetch, calls } = makeFakeFetch([okResponse(99)]);
            const events: PushOverlayTelemetry[] = [];
            const result = await pushOverlayV1({
                relayBaseUrl: 'https://r',
                sessionId: 's',
                overlay: { code: 'm', buildDurationMs: 0 },
                fetchImpl: fetch,
                onTelemetry: (e) => events.push(e),
                compatibility: () => 'unknown',
            });
            expect(result.ok).toBe(false);
            expect(calls).toHaveLength(0); // gate fired BEFORE the fetch
            if (result.ok) return;
            expect(result.attempts).toBe(0);
            expect(result.error).toContain('handshake has not completed');
            // Telemetry sees the failure with the compat-gate category so
            // the dashboard can chart Phase 11b fail-closed events
            // independently of network/validation failures.
            expect(events).toHaveLength(1);
            expect(events[0]!.ok).toBe(false);
            expect(events[0]!.error).toContain('handshake has not completed');
            expect(events[0]!.category).toBe('compat-gate');
        });

        test('OnlookRuntimeError gate path is also tagged compat-gate in telemetry', async () => {
            const events: PushOverlayTelemetry[] = [];
            const result = await pushOverlayV1({
                relayBaseUrl: 'https://r',
                sessionId: 's',
                overlay: { code: 'm', buildDurationMs: 0 },
                onTelemetry: (e) => events.push(e),
                compatibility: () => ({ kind: 'abi-mismatch', message: 'v0' }),
            });
            expect(result.ok).toBe(false);
            expect(events).toHaveLength(1);
            expect(events[0]!.category).toBe('compat-gate');
        });

        test('non-gate failures do NOT carry the compat-gate category', async () => {
            // sessionId/code/fetch failures should leave category undefined
            // so the dashboard's 'standard' (implicit) bucket stays clean.
            const events: PushOverlayTelemetry[] = [];
            await pushOverlayV1({
                relayBaseUrl: 'https://r',
                sessionId: '', // invalid → fails BEFORE the gate
                overlay: { code: 'm', buildDurationMs: 0 },
                onTelemetry: (e) => events.push(e),
                compatibility: () => 'ok',
            });
            expect(events).toHaveLength(1);
            expect(events[0]!.ok).toBe(false);
            expect(events[0]!.category).toBeUndefined();
        });

        test('fails-closed with kind+message when gate returns OnlookRuntimeError', async () => {
            const { fetch, calls } = makeFakeFetch([okResponse(99)]);
            const result = await pushOverlayV1({
                relayBaseUrl: 'https://r',
                sessionId: 's',
                overlay: { code: 'm', buildDurationMs: 0 },
                fetchImpl: fetch,
                onTelemetry: null,
                compatibility: () => ({
                    kind: 'abi-mismatch',
                    message: 'phone is on v0',
                }),
            });
            expect(result.ok).toBe(false);
            expect(calls).toHaveLength(0);
            if (result.ok) return;
            expect(result.error).toContain('abi-mismatch');
            expect(result.error).toContain('phone is on v0');
        });

        test('no gate = legacy behavior (push proceeds)', async () => {
            const { fetch, calls } = makeFakeFetch([okResponse(1)]);
            const result = await pushOverlayV1({
                relayBaseUrl: 'https://r',
                sessionId: 's',
                overlay: { code: 'm', buildDurationMs: 0 },
                fetchImpl: fetch,
                onTelemetry: null,
                // no compatibility option
            });
            expect(result.ok).toBe(true);
            expect(calls).toHaveLength(1);
        });

        test('gate runs AFTER sessionId/code validation (cheap checks first)', async () => {
            const compatCalls: number[] = [];
            const result = await pushOverlayV1({
                relayBaseUrl: 'https://r',
                sessionId: '', // invalid
                overlay: { code: 'm', buildDurationMs: 0 },
                onTelemetry: null,
                compatibility: () => {
                    compatCalls.push(1);
                    return 'ok';
                },
            });
            expect(result.ok).toBe(false);
            // sessionId guard fires first; the compat gate is never invoked.
            expect(compatCalls).toEqual([]);
        });
    });
});

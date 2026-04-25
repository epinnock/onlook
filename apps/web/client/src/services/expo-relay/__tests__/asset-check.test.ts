import { describe, expect, test } from 'bun:test';

import { checkAssetHashes } from '../asset-check';

type MinimalFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

function fakeFetch(responseFactory: () => Response | Error): {
    fetchImpl: MinimalFetch;
    calls: Array<{ url: string; body: unknown }>;
} {
    const calls: Array<{ url: string; body: unknown }> = [];
    return {
        calls,
        fetchImpl: async (input, init) => {
            const url = typeof input === 'string' ? input : (input as Request).url;
            let body: unknown;
            try {
                body = typeof init?.body === 'string' ? JSON.parse(init.body) : init?.body;
            } catch {
                body = init?.body;
            }
            calls.push({ url, body });
            const resp = responseFactory();
            if (resp instanceof Error) throw resp;
            return resp;
        },
    };
}

describe('asset-check / checkAssetHashes', () => {
    test('empty hash list short-circuits — no network call', async () => {
        const { fetchImpl, calls } = fakeFetch(() => new Response('{}'));
        const r = await checkAssetHashes({
            relayBaseUrl: 'https://r',
            sessionId: 's',
            hashes: [],
            fetchImpl,
        });
        expect(r.known.size).toBe(0);
        expect(r.unknown).toEqual([]);
        expect(calls).toHaveLength(0);
    });

    test('all hashes known on server → unknown list empty', async () => {
        const { fetchImpl, calls } = fakeFetch(
            () =>
                new Response(JSON.stringify({ known: ['a', 'b'] }), {
                    status: 200,
                    headers: { 'Content-Type': 'application/json' },
                }),
        );
        const r = await checkAssetHashes({
            relayBaseUrl: 'https://r',
            sessionId: 's',
            hashes: ['a', 'b'],
            fetchImpl,
        });
        expect(r.known).toEqual(new Set(['a', 'b']));
        expect(r.unknown).toEqual([]);
        expect(calls[0]!.url).toBe('https://r/assets/check');
        expect(calls[0]!.body).toEqual({ sessionId: 's', hashes: ['a', 'b'] });
    });

    test('mix of known + novel hashes returns only the novel ones as unknown', async () => {
        const { fetchImpl } = fakeFetch(
            () => new Response(JSON.stringify({ known: ['a'] }), { status: 200 }),
        );
        const r = await checkAssetHashes({
            relayBaseUrl: 'https://r',
            sessionId: 's',
            hashes: ['a', 'b', 'c'],
            fetchImpl,
        });
        expect(r.unknown).toEqual(['b', 'c']);
    });

    test('network error → safe default: treat all as unknown so editor re-uploads', async () => {
        const { fetchImpl } = fakeFetch(() => new Error('ECONNREFUSED'));
        const r = await checkAssetHashes({
            relayBaseUrl: 'https://r',
            sessionId: 's',
            hashes: ['a', 'b'],
            fetchImpl,
        });
        expect(r.unknown).toEqual(['a', 'b']);
    });

    test('HTTP 5xx → safe default', async () => {
        const { fetchImpl } = fakeFetch(() => new Response('oops', { status: 503 }));
        const r = await checkAssetHashes({
            relayBaseUrl: 'https://r',
            sessionId: 's',
            hashes: ['a'],
            fetchImpl,
        });
        expect(r.unknown).toEqual(['a']);
    });

    test('deduplicates input hashes before querying', async () => {
        const { fetchImpl, calls } = fakeFetch(
            () => new Response(JSON.stringify({ known: [] }), { status: 200 }),
        );
        await checkAssetHashes({
            relayBaseUrl: 'https://r',
            sessionId: 's',
            hashes: ['a', 'a', 'b', 'b', 'b'],
            fetchImpl,
        });
        expect((calls[0]!.body as { hashes: string[] }).hashes).toEqual(['a', 'b']);
    });
});

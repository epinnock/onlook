import { describe, expect, test } from 'bun:test';

import { checkAssetHashes } from '../asset-check';

type MinimalFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

interface FakeCall {
    url: string;
    method: string;
}

/**
 * Per-hash HEAD fake. Maps hash → response factory; default (no entry) is 404.
 */
function fakeFetch(responses: Map<string, () => Response | Error>): {
    fetchImpl: MinimalFetch;
    calls: FakeCall[];
} {
    const calls: FakeCall[] = [];
    return {
        calls,
        fetchImpl: async (input, init) => {
            const url = typeof input === 'string' ? input : (input as Request).url;
            calls.push({ url, method: init?.method ?? 'GET' });
            // Extract hash from `/base-bundle/assets/<hash>` for lookup.
            const match = /\/base-bundle\/assets\/([^/]+)$/.exec(url);
            const hash = match ? decodeURIComponent(match[1]!) : '';
            const factory = responses.get(hash);
            if (!factory) {
                return new Response(null, { status: 404 });
            }
            const resp = factory();
            if (resp instanceof Error) throw resp;
            return resp;
        },
    };
}

const ok = (): Response => new Response(null, { status: 200 });

describe('asset-check / checkAssetHashes', () => {
    test('empty hash list short-circuits — no network call', async () => {
        const { fetchImpl, calls } = fakeFetch(new Map());
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
            new Map([
                ['a', ok],
                ['b', ok],
            ]),
        );
        const r = await checkAssetHashes({
            relayBaseUrl: 'https://r',
            sessionId: 's',
            hashes: ['a', 'b'],
            fetchImpl,
        });
        expect(r.known).toEqual(new Set(['a', 'b']));
        expect(r.unknown).toEqual([]);
        // Each hash gets its own HEAD on the canonical relay endpoint.
        expect(calls).toHaveLength(2);
        for (const c of calls) {
            expect(c.method).toBe('HEAD');
            expect(c.url).toMatch(/^https:\/\/r\/base-bundle\/assets\/[ab]$/);
        }
    });

    test('mix of known + novel hashes returns only the novel ones as unknown', async () => {
        const { fetchImpl } = fakeFetch(new Map([['a', ok]]));
        const r = await checkAssetHashes({
            relayBaseUrl: 'https://r',
            sessionId: 's',
            hashes: ['a', 'b', 'c'],
            fetchImpl,
        });
        expect(Array.from(r.known)).toEqual(['a']);
        expect(r.unknown).toEqual(['b', 'c']);
    });

    test('network error per-hash → that hash falls into unknown', async () => {
        const { fetchImpl } = fakeFetch(
            new Map<string, () => Response | Error>([
                ['a', () => new Error('ECONNREFUSED')],
                ['b', ok],
            ]),
        );
        const r = await checkAssetHashes({
            relayBaseUrl: 'https://r',
            sessionId: 's',
            hashes: ['a', 'b'],
            fetchImpl,
        });
        expect(Array.from(r.known)).toEqual(['b']);
        expect(r.unknown).toEqual(['a']);
    });

    test('HTTP 5xx for a hash → safe default unknown for that hash only', async () => {
        const { fetchImpl } = fakeFetch(
            new Map<string, () => Response | Error>([
                ['a', () => new Response('oops', { status: 503 })],
                ['b', ok],
            ]),
        );
        const r = await checkAssetHashes({
            relayBaseUrl: 'https://r',
            sessionId: 's',
            hashes: ['a', 'b'],
            fetchImpl,
        });
        expect(Array.from(r.known)).toEqual(['b']);
        expect(r.unknown).toEqual(['a']);
    });

    test('deduplicates input hashes before querying', async () => {
        const { fetchImpl, calls } = fakeFetch(new Map());
        await checkAssetHashes({
            relayBaseUrl: 'https://r',
            sessionId: 's',
            hashes: ['a', 'a', 'b', 'b', 'b'],
            fetchImpl,
        });
        // 2 unique hashes → 2 HEADs.
        expect(calls).toHaveLength(2);
        const hashes = calls.map((c) => c.url.split('/').pop());
        expect(new Set(hashes)).toEqual(new Set(['a', 'b']));
    });

    test('windows parallel HEADs by `concurrency` option', async () => {
        // 6 hashes, concurrency=2 → 3 sequential batches of 2.
        const inflightAt: number[] = [];
        let inflight = 0;
        const fetchImpl: MinimalFetch = async () => {
            inflight += 1;
            inflightAt.push(inflight);
            // Yield to the next microtask so the cap is observable.
            await new Promise((r) => setTimeout(r, 0));
            inflight -= 1;
            return new Response(null, { status: 404 });
        };
        await checkAssetHashes({
            relayBaseUrl: 'https://r',
            sessionId: 's',
            hashes: ['a', 'b', 'c', 'd', 'e', 'f'],
            fetchImpl,
            concurrency: 2,
        });
        // Peak in-flight should never exceed concurrency.
        expect(Math.max(...inflightAt)).toBeLessThanOrEqual(2);
    });

    test('encodes hash safely in URL path', async () => {
        const { fetchImpl, calls } = fakeFetch(new Map());
        // Real hashes are sha256 hex so this is paranoia, but the encoder
        // contract should be respected for any future caller.
        await checkAssetHashes({
            relayBaseUrl: 'https://r',
            sessionId: 's',
            hashes: ['needs/encoding'],
            fetchImpl,
        });
        expect(calls[0]!.url).toBe('https://r/base-bundle/assets/needs%2Fencoding');
    });
});

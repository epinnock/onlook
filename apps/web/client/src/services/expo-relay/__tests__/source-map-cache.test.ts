/**
 * Tests for `source-map-cache.ts` — the memoizing cache + ErrorMessage
 * decoration middleware that closes the v2 row #35 receive-chain
 * production-wiring gap (one connect-call away from being live).
 */
import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';

import type { ErrorMessage } from '@onlook/mobile-client-protocol';

import {
    createSourceMapCache,
    withSourceMapDecoration,
    type SourceMapCache,
} from '../source-map-cache';
import type { RawSourceMap } from '../overlay-sourcemap';

const MAP_URL = 'https://r2.example.com/maps/abc.map';
const MAP_URL_B = 'https://r2.example.com/maps/def.map';

const sampleMap: RawSourceMap = {
    version: 3,
    sources: ['App.tsx'],
    names: [],
    mappings: 'AAAA',
};

function makeErrMsg(overrides: Partial<ErrorMessage> = {}): ErrorMessage {
    return {
        type: 'onlook:error',
        sessionId: 'sess-1',
        kind: 'js',
        message: 'boom',
        timestamp: 1_712_000_000_000,
        ...overrides,
    };
}

function makeFakeFetch(payloads: Map<string, RawSourceMap | 'fail'>): {
    fetchImpl: (input: RequestInfo | URL) => Promise<Response>;
    callCount: () => number;
    urls: () => readonly string[];
} {
    const calls: string[] = [];
    return {
        callCount: () => calls.length,
        urls: () => calls.slice(),
        fetchImpl: async (input) => {
            const url = input instanceof URL ? input.toString() : String(input);
            calls.push(url);
            const payload = payloads.get(url);
            if (payload === undefined) {
                return new Response('not found', { status: 404 });
            }
            if (payload === 'fail') {
                return new Response('boom', { status: 500 });
            }
            return new Response(JSON.stringify(payload), {
                status: 200,
                headers: { 'Content-Type': 'application/json' },
            });
        },
    };
}

describe('createSourceMapCache', () => {
    test('first call performs a fetch; second call with same URL hits cache', async () => {
        const fake = makeFakeFetch(new Map([[MAP_URL, sampleMap]]));
        const cache = createSourceMapCache({ fetchImpl: fake.fetchImpl });

        const a = await cache.get(MAP_URL);
        const b = await cache.get(MAP_URL);
        expect(a).toEqual(sampleMap);
        expect(b).toEqual(sampleMap);
        expect(fake.callCount()).toBe(1);
    });

    test('different URLs each get their own fetch', async () => {
        const fake = makeFakeFetch(
            new Map<string, RawSourceMap>([
                [MAP_URL, sampleMap],
                [MAP_URL_B, sampleMap],
            ]),
        );
        const cache = createSourceMapCache({ fetchImpl: fake.fetchImpl });

        await cache.get(MAP_URL);
        await cache.get(MAP_URL_B);
        expect(fake.callCount()).toBe(2);
        expect(fake.urls()).toEqual([MAP_URL, MAP_URL_B]);
    });

    test('concurrent calls for the same URL share one in-flight fetch', async () => {
        let resolveFetch!: (v: Response) => void;
        const fetchImpl = mock(
            (): Promise<Response> =>
                new Promise<Response>((resolve) => {
                    resolveFetch = resolve;
                }),
        );
        const cache = createSourceMapCache({ fetchImpl });

        const p1 = cache.get(MAP_URL);
        const p2 = cache.get(MAP_URL);
        const p3 = cache.get(MAP_URL);

        // Only one fetch should have started.
        expect(fetchImpl).toHaveBeenCalledTimes(1);

        resolveFetch(
            new Response(JSON.stringify(sampleMap), {
                status: 200,
                headers: { 'Content-Type': 'application/json' },
            }),
        );

        const [r1, r2, r3] = await Promise.all([p1, p2, p3]);
        expect(r1).toEqual(sampleMap);
        expect(r2).toEqual(sampleMap);
        expect(r3).toEqual(sampleMap);
        expect(fetchImpl).toHaveBeenCalledTimes(1);
    });

    test('failed fetches are also cached (do NOT keep retrying a 404)', async () => {
        const fake = makeFakeFetch(new Map<string, RawSourceMap | 'fail'>());
        const cache = createSourceMapCache({ fetchImpl: fake.fetchImpl });

        const a = await cache.get('https://nope.example.com/missing.map');
        const b = await cache.get('https://nope.example.com/missing.map');
        expect(a).toBeNull();
        expect(b).toBeNull();
        expect(fake.callCount()).toBe(1); // not 2
    });

    test('invalidate(url) drops a single entry; subsequent get refetches', async () => {
        const fake = makeFakeFetch(new Map([[MAP_URL, sampleMap]]));
        const cache = createSourceMapCache({ fetchImpl: fake.fetchImpl });

        await cache.get(MAP_URL);
        cache.invalidate(MAP_URL);
        await cache.get(MAP_URL);
        expect(fake.callCount()).toBe(2);
    });

    test('clear() drops all entries', async () => {
        const fake = makeFakeFetch(
            new Map<string, RawSourceMap>([
                [MAP_URL, sampleMap],
                [MAP_URL_B, sampleMap],
            ]),
        );
        const cache = createSourceMapCache({ fetchImpl: fake.fetchImpl });

        await cache.get(MAP_URL);
        await cache.get(MAP_URL_B);
        cache.clear();
        await cache.get(MAP_URL);
        await cache.get(MAP_URL_B);
        expect(fake.callCount()).toBe(4);
    });
});

describe('withSourceMapDecoration', () => {
    let cache: SourceMapCache;
    let receivedAll: ErrorMessage[];

    beforeEach(() => {
        receivedAll = [];
    });
    afterEach(() => {
        cache?.clear();
    });

    test('always delivers undecorated synchronously; decorated arrives later', async () => {
        const fake = makeFakeFetch(new Map([[MAP_URL, sampleMap]]));
        cache = createSourceMapCache({ fetchImpl: fake.fetchImpl });
        const wrapped = withSourceMapDecoration(
            (msg) => receivedAll.push(msg),
            { cache, resolveMapUrl: () => MAP_URL },
        );

        const incoming = makeErrMsg({ stack: 'at bundle.js:1:0' });
        wrapped(incoming);

        // Synchronous: first delivery is the undecorated message exactly.
        expect(receivedAll).toHaveLength(1);
        expect(receivedAll[0]).toBe(incoming);
        expect(receivedAll[0]!.source).toBeUndefined();

        // Wait for the cache fetch to complete + the second delivery.
        await new Promise((r) => setTimeout(r, 20));
        expect(receivedAll).toHaveLength(2);
        expect(receivedAll[1]!.source).toEqual({
            fileName: 'App.tsx',
            lineNumber: 1,
            columnNumber: 0,
        });
    });

    test('skips re-delivery when resolveMapUrl returns null', async () => {
        const fake = makeFakeFetch(new Map());
        cache = createSourceMapCache({ fetchImpl: fake.fetchImpl });
        const wrapped = withSourceMapDecoration(
            (msg) => receivedAll.push(msg),
            { cache, resolveMapUrl: () => null },
        );

        wrapped(makeErrMsg({ stack: 'at bundle.js:1:0' }));
        await new Promise((r) => setTimeout(r, 20));

        // Only the undecorated delivery; no fetch attempted.
        expect(receivedAll).toHaveLength(1);
        expect(fake.callCount()).toBe(0);
    });

    test('skips re-delivery when fetch returns null map', async () => {
        const fake = makeFakeFetch(new Map<string, RawSourceMap | 'fail'>([[MAP_URL, 'fail']]));
        cache = createSourceMapCache({ fetchImpl: fake.fetchImpl });
        const wrapped = withSourceMapDecoration(
            (msg) => receivedAll.push(msg),
            { cache, resolveMapUrl: () => MAP_URL },
        );

        wrapped(makeErrMsg({ stack: 'at bundle.js:1:0' }));
        await new Promise((r) => setTimeout(r, 20));

        expect(receivedAll).toHaveLength(1); // only undecorated
    });

    test('skips re-delivery when decoration returns the same message (no frame match)', async () => {
        const fake = makeFakeFetch(new Map([[MAP_URL, sampleMap]]));
        cache = createSourceMapCache({ fetchImpl: fake.fetchImpl });
        const wrapped = withSourceMapDecoration(
            (msg) => receivedAll.push(msg),
            { cache, resolveMapUrl: () => MAP_URL },
        );

        // No stack → decorate returns input unchanged.
        wrapped(makeErrMsg({ stack: undefined }));
        await new Promise((r) => setTimeout(r, 20));

        expect(receivedAll).toHaveLength(1); // only undecorated; no second delivery
    });

    test('multiple incoming errors share one in-flight fetch via the cache', async () => {
        const fake = makeFakeFetch(new Map([[MAP_URL, sampleMap]]));
        cache = createSourceMapCache({ fetchImpl: fake.fetchImpl });
        const wrapped = withSourceMapDecoration(
            (msg) => receivedAll.push(msg),
            { cache, resolveMapUrl: () => MAP_URL },
        );

        wrapped(makeErrMsg({ timestamp: 1, stack: 'at bundle.js:1:0' }));
        wrapped(makeErrMsg({ timestamp: 2, stack: 'at bundle.js:1:0' }));
        wrapped(makeErrMsg({ timestamp: 3, stack: 'at bundle.js:1:0' }));
        await new Promise((r) => setTimeout(r, 20));

        // 3 undecorated + 3 decorated = 6 deliveries; 1 fetch.
        expect(receivedAll).toHaveLength(6);
        expect(fake.callCount()).toBe(1);
    });
});

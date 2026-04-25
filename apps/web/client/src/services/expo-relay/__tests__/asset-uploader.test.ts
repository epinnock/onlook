import { describe, expect, test } from 'bun:test';

import {
    sha256HexOfBytes,
    uploadAsset,
    uploadAssetBytes,
} from '../asset-uploader';

type MinimalFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

function fakeFetch(responseFactory: () => Response | Error): {
    fetch: MinimalFetch;
    calls: Array<{ url: string; method: string; body: unknown; headers: Headers }>;
} {
    const calls: Array<{ url: string; method: string; body: unknown; headers: Headers }> = [];
    return {
        calls,
        fetch: async (input, init) => {
            const url = typeof input === 'string' ? input : (input as Request).url;
            calls.push({
                url,
                method: init?.method ?? 'GET',
                body: init?.body,
                headers: new Headers(init?.headers ?? {}),
            });
            const resp = responseFactory();
            if (resp instanceof Error) throw resp;
            return resp;
        },
    };
}

describe('asset-uploader / sha256HexOfBytes', () => {
    test('produces a 64-char hex digest', async () => {
        const bytes = new TextEncoder().encode('hello');
        const hash = await sha256HexOfBytes(bytes);
        expect(hash.length).toBe(64);
        expect(/^[0-9a-f]{64}$/.test(hash)).toBe(true);
    });

    test('same bytes → same hash (deterministic)', async () => {
        const b = new Uint8Array([1, 2, 3]);
        const a = await sha256HexOfBytes(b);
        const c = await sha256HexOfBytes(b);
        expect(a).toBe(c);
    });
});

describe('asset-uploader / uploadAsset', () => {
    test('POSTs bytes to /assets/upload/:hash and parses uri', async () => {
        const { fetch, calls } = fakeFetch(
            () =>
                new Response(JSON.stringify({ uri: 'https://r2/assets/abc' }), {
                    status: 202,
                    headers: { 'Content-Type': 'application/json' },
                }),
        );
        const result = await uploadAsset({
            relayBaseUrl: 'https://relay.example.com',
            sessionId: 's1',
            bytes: new Uint8Array([1, 2, 3]),
            mime: 'image/png',
            hash: 'abc',
            fetchImpl: fetch,
        });
        expect(result).toEqual({ ok: true, uri: 'https://r2/assets/abc', hash: 'abc' });
        expect(calls[0]!.url).toBe('https://relay.example.com/assets/upload/abc');
        expect(calls[0]!.method).toBe('POST');
        expect(calls[0]!.headers.get('Content-Type')).toBe('image/png');
        expect(calls[0]!.headers.get('X-Onlook-Session-Id')).toBe('s1');
    });

    test('returns ok:false with status on 4xx', async () => {
        const { fetch } = fakeFetch(() => new Response('forbidden', { status: 403 }));
        const result = await uploadAsset({
            relayBaseUrl: 'https://r',
            sessionId: 's',
            bytes: new Uint8Array([1]),
            mime: 'image/png',
            hash: 'x',
            fetchImpl: fetch,
        });
        expect(result.ok).toBe(false);
        if (result.ok) return;
        expect(result.status).toBe(403);
    });

    test('returns ok:false when relay response lacks uri field', async () => {
        const { fetch } = fakeFetch(() => new Response(JSON.stringify({}), { status: 202 }));
        const result = await uploadAsset({
            relayBaseUrl: 'https://r',
            sessionId: 's',
            bytes: new Uint8Array([1]),
            mime: 'image/png',
            hash: 'x',
            fetchImpl: fetch,
        });
        expect(result.ok).toBe(false);
        if (result.ok) return;
        expect(result.error).toContain('no uri field');
    });

    test('network error bubbles as ok:false', async () => {
        const { fetch } = fakeFetch(() => new Error('ECONNREFUSED'));
        const result = await uploadAsset({
            relayBaseUrl: 'https://r',
            sessionId: 's',
            bytes: new Uint8Array([1]),
            mime: 'image/png',
            hash: 'x',
            fetchImpl: fetch,
        });
        expect(result.ok).toBe(false);
        if (result.ok) return;
        expect(result.error).toContain('ECONNREFUSED');
    });
});

describe('asset-uploader / uploadAssetBytes', () => {
    test('computes sha256 internally and passes through to uploadAsset', async () => {
        const { fetch, calls } = fakeFetch(
            () => new Response(JSON.stringify({ uri: 'u' }), { status: 202 }),
        );
        const result = await uploadAssetBytes({
            relayBaseUrl: 'https://r',
            sessionId: 's',
            bytes: new TextEncoder().encode('hello'),
            mime: 'text/plain',
            fetchImpl: fetch,
        });
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.hash.length).toBe(64);
        expect(calls[0]!.url).toContain('/assets/upload/' + result.hash);
    });
});

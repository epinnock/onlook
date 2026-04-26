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
    test('PUTs bytes to /base-bundle/assets/:hash and derives uri (201 created)', async () => {
        const { fetch, calls } = fakeFetch(
            () => new Response(null, { status: 201 }),
        );
        const result = await uploadAsset({
            relayBaseUrl: 'https://relay.example.com',
            sessionId: 's1',
            bytes: new Uint8Array([1, 2, 3]),
            mime: 'image/png',
            hash: 'abc',
            fetchImpl: fetch,
        });
        expect(result).toEqual({
            ok: true,
            uri: 'https://relay.example.com/base-bundle/assets/abc',
            hash: 'abc',
        });
        expect(calls[0]!.url).toBe('https://relay.example.com/base-bundle/assets/abc');
        expect(calls[0]!.method).toBe('PUT');
        expect(calls[0]!.headers.get('Content-Type')).toBe('image/png');
        expect(calls[0]!.headers.get('X-Onlook-Session-Id')).toBe('s1');
    });

    test('200 (overwrite) is also success — same uri shape', async () => {
        const { fetch } = fakeFetch(() => new Response(null, { status: 200 }));
        const result = await uploadAsset({
            relayBaseUrl: 'https://r',
            sessionId: 's',
            bytes: new Uint8Array([1]),
            mime: 'application/json',
            hash: 'def',
            fetchImpl: fetch,
        });
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.uri).toBe('https://r/base-bundle/assets/def');
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

    test('413 (over 10 MB cap) bubbles status verbatim', async () => {
        const { fetch } = fakeFetch(() => new Response('too big', { status: 413 }));
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
        expect(result.status).toBe(413);
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

    test('trailing slash in relayBaseUrl is normalised', async () => {
        const { fetch, calls } = fakeFetch(() => new Response(null, { status: 201 }));
        await uploadAsset({
            relayBaseUrl: 'https://r/',
            sessionId: 's',
            bytes: new Uint8Array([1]),
            mime: 'image/png',
            hash: 'norm',
            fetchImpl: fetch,
        });
        expect(calls[0]!.url).toBe('https://r/base-bundle/assets/norm');
    });
});

describe('asset-uploader / uploadAssetBytes', () => {
    test('computes sha256 internally and passes through to uploadAsset', async () => {
        const { fetch, calls } = fakeFetch(
            () => new Response(null, { status: 201 }),
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
        expect(calls[0]!.url).toContain('/base-bundle/assets/' + result.hash);
        expect(calls[0]!.method).toBe('PUT');
    });
});

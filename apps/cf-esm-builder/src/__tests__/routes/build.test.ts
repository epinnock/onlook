/// <reference types="bun" />
/**
 * Tests for `POST /build` (TH2.1).
 *
 * The route is exercised against a minimal mock `Env` — no Cloudflare runtime,
 * no real R2, no real Durable Object. The hash lib is stubbed via `mock.module`
 * because TH2.5 hasn't implemented `sha256OfTar` yet.
 */
import { beforeEach, describe, expect, mock, test } from 'bun:test';

const FIXED_HASH = 'fixedhash000000000000000000000000000000000000000000000000000000a';

mock.module('../../lib/hash', () => ({
    sha256OfTar: async (_buf: ArrayBuffer): Promise<string> => FIXED_HASH,
}));

import { handleBuild } from '../../routes/build';
import type { Env } from '../../types';

interface FakeR2 {
    head: ReturnType<typeof mock>;
}

interface FakeDoStub {
    fetch: ReturnType<typeof mock>;
}

interface FakeDoNamespace {
    idFromName: ReturnType<typeof mock>;
    get: ReturnType<typeof mock>;
}

function makeEnv(opts: {
    r2HeadResult?: unknown;
    doResponse?: Response;
}): { env: Env; r2: FakeR2; ns: FakeDoNamespace; stub: FakeDoStub } {
    const r2: FakeR2 = {
        head: mock(async (_key: string) => opts.r2HeadResult ?? null),
    };

    const stub: FakeDoStub = {
        fetch: mock(
            async (_req: Request) =>
                opts.doResponse ??
                new Response(
                    JSON.stringify({
                        buildId: FIXED_HASH,
                        sourceHash: FIXED_HASH,
                        cached: false,
                    }),
                    { status: 200, headers: { 'Content-Type': 'application/json' } },
                ),
        ),
    };

    const ns: FakeDoNamespace = {
        idFromName: mock((name: string) => ({ __id: name })),
        get: mock((_id: unknown) => stub),
    };

    // Cast through unknown — the workers-types `R2Bucket` / `DurableObjectNamespace`
    // are abstract, but the route only touches `head()` / `idFromName()` / `get()`.
    const env = {
        ESM_BUILDER: ns as unknown as Env['ESM_BUILDER'],
        BUILD_SESSION: ns as unknown as Env['BUILD_SESSION'],
        BUNDLES: r2 as unknown as Env['BUNDLES'],
    } as Env;

    return { env, r2, ns, stub };
}

function tarRequest(
    body: BodyInit,
    extraHeaders: Record<string, string> = {},
    contentType = 'application/x-tar',
): Request {
    return new Request('https://builder.test/build', {
        method: 'POST',
        headers: {
            'Content-Type': contentType,
            'X-Project-Id': 'proj-1',
            'X-Branch-Id': 'branch-1',
            ...extraHeaders,
        },
        body,
    });
}

describe('POST /build', () => {
    beforeEach(() => {
        // Reset mock counters between tests so call-count assertions are isolated.
    });

    test('returns 400 when X-Project-Id is missing', async () => {
        const { env } = makeEnv({});
        const req = new Request('https://builder.test/build', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-tar',
                'X-Branch-Id': 'branch-1',
            },
            body: new Uint8Array([1, 2, 3]),
        });

        const res = await handleBuild(req, env);
        expect(res.status).toBe(400);
        const body = (await res.json()) as { error: string };
        expect(body.error).toBe('missing X-Project-Id');
    });

    test('returns 400 when X-Branch-Id is missing', async () => {
        const { env } = makeEnv({});
        const req = new Request('https://builder.test/build', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-tar',
                'X-Project-Id': 'proj-1',
            },
            body: new Uint8Array([1, 2, 3]),
        });

        const res = await handleBuild(req, env);
        expect(res.status).toBe(400);
        const body = (await res.json()) as { error: string };
        expect(body.error).toBe('missing X-Branch-Id');
    });

    test('returns 400 when Content-Type is unsupported', async () => {
        const { env } = makeEnv({});
        const req = tarRequest(
            new Uint8Array([1, 2, 3]),
            {},
            'application/json',
        );

        const res = await handleBuild(req, env);
        expect(res.status).toBe(400);
        const body = (await res.json()) as { error: string };
        expect(body.error).toBe('unsupported content-type');
    });

    test('accepts application/gzip Content-Type', async () => {
        const { env, ns, stub } = makeEnv({});
        const req = tarRequest(
            new Uint8Array([1, 2, 3]),
            {},
            'application/gzip',
        );

        const res = await handleBuild(req, env);
        expect(res.status).toBe(200);
        expect(ns.get).toHaveBeenCalledTimes(1);
        expect(stub.fetch).toHaveBeenCalledTimes(1);
    });

    test('returns 413 when declared Content-Length exceeds 100 MB', async () => {
        const { env } = makeEnv({});
        const req = new Request('https://builder.test/build', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-tar',
                'X-Project-Id': 'proj-1',
                'X-Branch-Id': 'branch-1',
                'Content-Length': String(101 * 1024 * 1024),
            },
            body: new Uint8Array([1, 2, 3]),
        });

        const res = await handleBuild(req, env);
        expect(res.status).toBe(413);
        const body = (await res.json()) as { error: string };
        expect(body.error).toBe('body too large');
    });

    test('returns 200 cache hit when R2 has bundle/<hash>/meta.json', async () => {
        const { env, r2, stub } = makeEnv({
            r2HeadResult: { key: `bundle/${FIXED_HASH}/meta.json`, size: 42 },
        });
        const req = tarRequest(new Uint8Array([1, 2, 3, 4]));

        const res = await handleBuild(req, env);
        expect(res.status).toBe(200);
        const body = (await res.json()) as {
            buildId: string;
            sourceHash: string;
            cached: boolean;
        };
        expect(body.cached).toBe(true);
        expect(body.buildId).toBe(FIXED_HASH);
        expect(body.sourceHash).toBe(FIXED_HASH);

        // R2 was probed exactly once with the canonical key.
        expect(r2.head).toHaveBeenCalledTimes(1);
        expect(r2.head).toHaveBeenCalledWith(`bundle/${FIXED_HASH}/meta.json`);
        // The DO must NOT be touched on a cache hit.
        expect(stub.fetch).not.toHaveBeenCalled();
    });

    test('on cache miss: calls BUILD_SESSION DO and forwards its response', async () => {
        const doBody = JSON.stringify({
            buildId: FIXED_HASH,
            sourceHash: FIXED_HASH,
            cached: false,
        });
        const doResponse = new Response(doBody, {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
        });

        const { env, r2, ns, stub } = makeEnv({
            r2HeadResult: null,
            doResponse,
        });
        const req = tarRequest(new Uint8Array([9, 9, 9, 9]));

        const res = await handleBuild(req, env);
        expect(res.status).toBe(200);
        const body = (await res.json()) as {
            buildId: string;
            sourceHash: string;
            cached: boolean;
        };
        expect(body.cached).toBe(false);
        expect(body.sourceHash).toBe(FIXED_HASH);

        expect(r2.head).toHaveBeenCalledTimes(1);
        // DO is keyed by sourceHash for build coalescing.
        expect(ns.idFromName).toHaveBeenCalledWith(FIXED_HASH);
        expect(ns.get).toHaveBeenCalledTimes(1);
        expect(stub.fetch).toHaveBeenCalledTimes(1);
    });
});

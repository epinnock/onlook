/// <reference types="bun" />
/**
 * TH3.1 / TH3.3 — `cf-esm-cache` SWR proxy worker tests.
 *
 * Exercises the bundle proxy handler without a real Cloudflare runtime:
 * `env.BUNDLES` is a hand-rolled R2-shaped fake and `env.BUILDER` is a stub
 * fetcher returning canned responses. This mirrors the pattern used by
 * `cf-esm-builder/src/__tests__/routes/bundle.test.ts`.
 */
import { describe, expect, test } from 'bun:test';

import worker from '../worker';
import type { Env } from '../worker';

interface StoredObject {
    body: Uint8Array;
}

interface FakeR2Object {
    body: ReadableStream<Uint8Array>;
}

interface PutCall {
    key: string;
    // Capture the stream as bytes so tests can assert what was cached.
    bytes: Uint8Array;
}

interface BundlesStub {
    bucket: R2Bucket;
    puts: PutCall[];
    /** Wait until every in-flight put() has settled. */
    drainPuts(): Promise<void>;
}

function makeBundlesStub(map: Record<string, StoredObject>): BundlesStub {
    const puts: PutCall[] = [];
    const inflight: Promise<unknown>[] = [];

    const bucket = {
        async get(key: string): Promise<FakeR2Object | null> {
            const entry = map[key];
            if (!entry) return null;
            const bytes = entry.body;
            return {
                body: new ReadableStream<Uint8Array>({
                    start(controller) {
                        controller.enqueue(bytes);
                        controller.close();
                    },
                }),
            };
        },
        async put(
            key: string,
            value: ReadableStream<Uint8Array> | ArrayBuffer | Uint8Array,
        ): Promise<void> {
            const p = (async (): Promise<void> => {
                let bytes: Uint8Array;
                if (value instanceof ReadableStream) {
                    const reader = value.getReader();
                    const chunks: Uint8Array[] = [];
                    let total = 0;
                    for (;;) {
                        const { value: chunk, done } = await reader.read();
                        if (done) break;
                        if (chunk) {
                            chunks.push(chunk);
                            total += chunk.byteLength;
                        }
                    }
                    bytes = new Uint8Array(total);
                    let off = 0;
                    for (const c of chunks) {
                        bytes.set(c, off);
                        off += c.byteLength;
                    }
                } else if (value instanceof Uint8Array) {
                    bytes = value;
                } else {
                    bytes = new Uint8Array(value);
                }
                puts.push({ key, bytes });
                map[key] = { body: bytes };
            })();
            inflight.push(p);
            return p;
        },
    };

    return {
        bucket: bucket as unknown as R2Bucket,
        puts,
        async drainPuts() {
            await Promise.allSettled(inflight);
        },
    };
}

interface BuilderStub {
    fetcher: Fetcher;
    calls: string[];
}

function makeBuilderStub(
    respond: (req: Request) => Response | Promise<Response>,
): BuilderStub {
    const calls: string[] = [];
    const fetcher = {
        async fetch(input: Request | string, init?: RequestInit): Promise<Response> {
            const req = typeof input === 'string' ? new Request(input, init) : input;
            calls.push(req.url);
            return respond(req);
        },
    };
    return { fetcher: fetcher as unknown as Fetcher, calls };
}

function envWith(bundles: BundlesStub, builder: BuilderStub): Env {
    return {
        BUNDLES: bundles.bucket,
        BUILDER: builder.fetcher,
    };
}

async function invoke(env: Env, request: Request): Promise<Response> {
    // The worker default export is an ExportedHandler; its `fetch` always
    // exists in practice. A local narrow + throw keeps the test strictly
    // typed without `any` or non-null assertions. Our handler declares
    // (request, env) — TypeScript narrows the ExportedHandler fetch to that
    // shape via `satisfies`, so we call with exactly two arguments here.
    const handler = worker.fetch;
    if (!handler) throw new Error('worker.fetch is undefined');
    return handler(request, env);
}

const HASH = 'c6a1fbc03d4e7f1234567890abcdef0123456789abcdef0123456789abcdef01';
const HERMES_MAGIC = new Uint8Array([0xc6, 0x1f, 0xbc, 0x03, 0x00, 0x01, 0x02, 0x03]);

describe('cf-esm-cache worker (TH3.1)', () => {
    test('GET /health returns 200 with ok=true', async () => {
        const bundles = makeBundlesStub({});
        const builder = makeBuilderStub(() => new Response('unused'));
        const env = envWith(bundles, builder);

        const res = await invoke(env, new Request('https://cache.test/health'));
        expect(res.status).toBe(200);
        const json = (await res.json()) as { ok: boolean; version: string };
        expect(json.ok).toBe(true);
        expect(typeof json.version).toBe('string');
    });

    test('GET /bundle/<hash> cache HIT returns cached body + X-Cache: HIT + immutable', async () => {
        const bundles = makeBundlesStub({
            [`bundle/${HASH}/index.android.bundle`]: { body: HERMES_MAGIC },
        });
        const builder = makeBuilderStub(() => {
            throw new Error('BUILDER must not be called on a cache hit');
        });
        const env = envWith(bundles, builder);

        const res = await invoke(env, new Request(`https://cache.test/bundle/${HASH}`));
        expect(res.status).toBe(200);
        expect(res.headers.get('X-Cache')).toBe('HIT');
        expect(res.headers.get('Content-Type')).toBe('application/javascript');
        expect(res.headers.get('Cache-Control')).toBe(
            'public, max-age=31536000, immutable',
        );
        expect(res.headers.get('ETag')).toBe(`"${HASH}"`);
        expect(builder.calls.length).toBe(0);

        const body = new Uint8Array(await res.arrayBuffer());
        expect(body[0]).toBe(0xc6);
        expect(body.byteLength).toBe(HERMES_MAGIC.byteLength);
    });

    test('GET /bundle/<hash> cache MISS fetches from BUILDER and returns X-Cache: MISS', async () => {
        const bundles = makeBundlesStub({});
        const builder = makeBuilderStub(
            () =>
                new Response(HERMES_MAGIC, {
                    status: 200,
                    headers: { 'Content-Type': 'application/javascript' },
                }),
        );
        const env = envWith(bundles, builder);

        const res = await invoke(env, new Request(`https://cache.test/bundle/${HASH}`));
        expect(res.status).toBe(200);
        expect(res.headers.get('X-Cache')).toBe('MISS');
        expect(res.headers.get('Content-Type')).toBe('application/javascript');
        expect(res.headers.get('ETag')).toBe(`"${HASH}"`);

        const body = new Uint8Array(await res.arrayBuffer());
        expect(body.byteLength).toBe(HERMES_MAGIC.byteLength);
        expect(body[0]).toBe(0xc6);

        expect(builder.calls.length).toBe(1);
        expect(builder.calls[0]).toContain(`/bundle/${HASH}/index.android.bundle`);

        // Background R2 put should have been scheduled with the same bytes.
        await bundles.drainPuts();
        expect(bundles.puts.length).toBe(1);
        expect(bundles.puts[0]?.key).toBe(`bundle/${HASH}/index.android.bundle`);
        expect(bundles.puts[0]?.bytes.byteLength).toBe(HERMES_MAGIC.byteLength);
    });

    test('GET /bundle/<hash> cache MISS + upstream 404 bubbles through as 404 and does not cache', async () => {
        const bundles = makeBundlesStub({});
        const builder = makeBuilderStub(() => new Response('nope', { status: 404 }));
        const env = envWith(bundles, builder);

        const res = await invoke(env, new Request(`https://cache.test/bundle/${HASH}`));
        expect(res.status).toBe(404);
        await bundles.drainPuts();
        expect(bundles.puts.length).toBe(0);
    });

    test('GET /bundle/<hash>/assetmap.json returns application/json content-type', async () => {
        const assetBytes = new TextEncoder().encode('{"assets":[]}');
        const bundles = makeBundlesStub({
            [`bundle/${HASH}/assetmap.json`]: { body: assetBytes },
        });
        const builder = makeBuilderStub(() => new Response('unused'));
        const env = envWith(bundles, builder);

        const res = await invoke(
            env,
            new Request(`https://cache.test/bundle/${HASH}/assetmap.json`),
        );
        expect(res.status).toBe(200);
        expect(res.headers.get('Content-Type')).toBe('application/json');
        expect(res.headers.get('X-Cache')).toBe('HIT');
        const parsed = (await res.json()) as { assets: unknown[] };
        expect(parsed.assets).toEqual([]);
    });

    test('GET /unknown returns 404', async () => {
        const bundles = makeBundlesStub({});
        const builder = makeBuilderStub(() => new Response('unused'));
        const env = envWith(bundles, builder);

        const res = await invoke(env, new Request('https://cache.test/unknown'));
        expect(res.status).toBe(404);
    });

    test('POST /bundle/<hash> (wrong method) returns 404', async () => {
        const bundles = makeBundlesStub({
            [`bundle/${HASH}/index.android.bundle`]: { body: HERMES_MAGIC },
        });
        const builder = makeBuilderStub(() => new Response('unused'));
        const env = envWith(bundles, builder);

        const res = await invoke(
            env,
            new Request(`https://cache.test/bundle/${HASH}`, { method: 'POST' }),
        );
        expect(res.status).toBe(404);
    });
});

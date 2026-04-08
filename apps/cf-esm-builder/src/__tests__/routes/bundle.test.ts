/// <reference types="bun" />
/**
 * TH2.3 — `GET /bundle/:hash` route tests for `cf-esm-builder`.
 *
 * Stubs `env.BUNDLES` with an in-memory R2-shaped fake so we can exercise the
 * route without wrangler. The shapes here mirror the locked artifact contract
 * in `plans/expo-browser-bundle-artifact.md`.
 */
import { describe, expect, test } from 'bun:test';

import { handleBundle } from '../../routes/bundle';
import type { Env } from '../../types';

interface StoredObject {
    body: Uint8Array;
}

interface FakeR2Object {
    body: ReadableStream<Uint8Array>;
    json: () => Promise<unknown>;
}

interface FakeR2Head {
    size: number;
}

function makeBundlesStub(map: Record<string, StoredObject>): R2Bucket {
    const bucket = {
        async head(key: string): Promise<FakeR2Head | null> {
            const entry = map[key];
            if (!entry) return null;
            return { size: entry.body.byteLength };
        },
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
                async json() {
                    return JSON.parse(new TextDecoder().decode(bytes));
                },
            };
        },
    };
    // The fake only implements `head` + `get`; the route never touches the
    // rest of the R2Bucket surface, so the cast keeps test code free of `any`.
    return bucket as unknown as R2Bucket;
}

function envWith(map: Record<string, StoredObject>): Env {
    return {
        ESM_BUILDER: {} as unknown as DurableObjectNamespace,
        BUILD_SESSION: {} as unknown as DurableObjectNamespace,
        BUNDLES: makeBundlesStub(map),
    };
}

const HASH = 'c6a1fbc03d4e7f1234567890abcdef0123456789abcdef0123456789abcdef01';
const HERMES_MAGIC = new Uint8Array([0xc6, 0x1f, 0xbc, 0x03, 0x00, 0x01, 0x02, 0x03]);

function jsonBytes(value: unknown): Uint8Array {
    return new TextEncoder().encode(JSON.stringify(value));
}

function fullBundleStore(): Record<string, StoredObject> {
    return {
        [`bundle/${HASH}/index.android.bundle`]: { body: HERMES_MAGIC },
        [`bundle/${HASH}/assetmap.json`]: { body: jsonBytes({ assets: [] }) },
        [`bundle/${HASH}/sourcemap.json`]: {
            body: jsonBytes({ version: 3, sources: [], mappings: '' }),
        },
        [`bundle/${HASH}/meta.json`]: {
            body: jsonBytes({
                sourceHash: HASH,
                bundleHash: HASH,
                builtAt: '2026-04-07T12:34:56.000Z',
                expoSdkVersion: '54.0.0',
                hermesVersion: '0.12.0',
                sizeBytes: HERMES_MAGIC.byteLength,
                fileCount: 5,
            }),
        },
    };
}

function get(path: string, headers?: Record<string, string>): Request {
    return new Request(`https://builder.test${path}`, { method: 'GET', headers });
}

describe('handleBundle (TH2.3)', () => {
    test('returns 404 when the hash is not in R2', async () => {
        const env = envWith({});
        const res = await handleBundle(get(`/bundle/${HASH}`), env);
        expect(res.status).toBe(404);
    });

    test('returns 200 with bundle bytes, javascript content-type, and immutable cache header', async () => {
        const env = envWith(fullBundleStore());
        const res = await handleBundle(get(`/bundle/${HASH}`), env);

        expect(res.status).toBe(200);
        expect(res.headers.get('Content-Type')).toBe('application/javascript');
        expect(res.headers.get('Cache-Control')).toBe(
            'public, max-age=31536000, immutable',
        );
        expect(res.headers.get('ETag')).toBe(`"${HASH}"`);
        expect(res.headers.get('X-Hermes-Version')).toBe('0.12.0');

        const body = new Uint8Array(await res.arrayBuffer());
        expect(body.length).toBe(HERMES_MAGIC.byteLength);
        // Hermes magic is the canonical "is this a real Hermes bundle" check
        // (`expo-browser-bundle-artifact.md` §index.android.bundle).
        expect(body[0]).toBe(0xc6);
        expect(body[1]).toBe(0x1f);
        expect(body[2]).toBe(0xbc);
        expect(body[3]).toBe(0x03);
    });

    test('returns 304 when If-None-Match matches the etag', async () => {
        const env = envWith(fullBundleStore());
        const res = await handleBundle(
            get(`/bundle/${HASH}`, { 'If-None-Match': `"${HASH}"` }),
            env,
        );

        expect(res.status).toBe(304);
        expect(res.headers.get('ETag')).toBe(`"${HASH}"`);
        expect(res.headers.get('Cache-Control')).toBe(
            'public, max-age=31536000, immutable',
        );
        // 304 must not carry a body.
        const body = await res.arrayBuffer();
        expect(body.byteLength).toBe(0);
    });

    test('serves /bundle/<hash>/assetmap.json as application/json', async () => {
        const env = envWith(fullBundleStore());
        const res = await handleBundle(get(`/bundle/${HASH}/assetmap.json`), env);

        expect(res.status).toBe(200);
        expect(res.headers.get('Content-Type')).toBe('application/json');
        expect(res.headers.get('ETag')).toBe(`"${HASH}"`);
        const parsed = (await res.json()) as { assets: unknown[] };
        expect(parsed.assets).toEqual([]);
    });

    test('serves /bundle/<hash>/sourcemap.json as application/json', async () => {
        const env = envWith(fullBundleStore());
        const res = await handleBundle(get(`/bundle/${HASH}/sourcemap.json`), env);

        expect(res.status).toBe(200);
        expect(res.headers.get('Content-Type')).toBe('application/json');
        const parsed = (await res.json()) as { version: number };
        expect(parsed.version).toBe(3);
    });

    test('returns 404 for an unknown sub-path', async () => {
        const env = envWith(fullBundleStore());
        const res = await handleBundle(
            get(`/bundle/${HASH}/secrets.tar.gz`),
            env,
        );
        expect(res.status).toBe(404);
    });

    test('returns 404 when If-None-Match matches a hash that no longer exists', async () => {
        // A stale browser cache must not be able to pin a 304 to a deleted
        // bundle — the route still has to verify R2 has the object.
        const env = envWith({});
        const res = await handleBundle(
            get(`/bundle/${HASH}`, { 'If-None-Match': `"${HASH}"` }),
            env,
        );
        expect(res.status).toBe(404);
    });
});

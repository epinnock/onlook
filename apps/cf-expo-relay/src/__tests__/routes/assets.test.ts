/// <reference types="bun" />
import { describe, expect, test } from 'bun:test';

import { handleBaseBundleAssetsRoute, parseBaseBundleAssetsRoute } from '../../routes/assets';
import type { Env } from '../../env';

interface MockAsset {
    readonly body: ReadableStream<Uint8Array>;
    writeHttpMetadata(headers: Headers): void;
}

function makeAsset(body: string, contentType = 'text/plain; charset=utf-8'): MockAsset {
    return {
        body: new Response(body).body ?? new ReadableStream<Uint8Array>(),
        writeHttpMetadata(headers: Headers): void {
            headers.set('Content-Type', contentType);
        },
    };
}

interface PutCall {
    readonly key: string;
    readonly bytes: Uint8Array;
    readonly contentType?: string;
}

function makeBucket(
    entries: Record<string, MockAsset | undefined> = {},
    putCalls?: PutCall[],
): R2Bucket {
    return {
        async get(key: string): Promise<MockAsset | null> {
            return entries[key] ?? null;
        },
        async head(key: string): Promise<MockAsset | null> {
            return entries[key] ?? null;
        },
        async put(
            key: string,
            value: ArrayBuffer | Uint8Array | string,
            options?: { httpMetadata?: { contentType?: string } },
        ): Promise<R2Object | null> {
            const bytes =
                typeof value === 'string'
                    ? new TextEncoder().encode(value)
                    : value instanceof Uint8Array
                      ? value
                      : new Uint8Array(value);
            putCalls?.push({
                key,
                bytes,
                contentType: options?.httpMetadata?.contentType,
            });
            entries[key] = {
                body: new Response(bytes).body ?? new ReadableStream<Uint8Array>(),
                writeHttpMetadata(headers) {
                    if (options?.httpMetadata?.contentType) {
                        headers.set('Content-Type', options.httpMetadata.contentType);
                    }
                },
            };
            return null;
        },
    } as R2Bucket;
}

function makeEnv(bucket: R2Bucket = makeBucket()): Env {
    return {
        BUNDLES: {} as KVNamespace,
        BASE_BUNDLES: bucket,
        EXPO_SESSION: {} as Env['EXPO_SESSION'],
        ESM_CACHE_URL: 'https://cf-esm-cache.dev.workers.dev',
    };
}

function request(
    pathname: string,
    method = 'GET',
    init: { body?: BodyInit; headers?: HeadersInit } = {},
): Request {
    return new Request(`https://expo-relay.dev.workers.dev${pathname}`, {
        method,
        body: init.body,
        headers: init.headers,
    });
}

describe('parseBaseBundleAssetsRoute', () => {
    test('accepts canonical base-bundle asset paths under the assets prefix', () => {
        expect(parseBaseBundleAssetsRoute(request('/base-bundle/assets/logo.png'))).toEqual({
            assetKey: 'assets/logo.png',
        });
    });

    test('accepts the plural route prefix too', () => {
        expect(parseBaseBundleAssetsRoute(request('/base-bundles/assets/nested/icon.svg'))).toEqual(
            {
                assetKey: 'assets/nested/icon.svg',
            },
        );
    });

    test('rejects empty keys and traversal attempts', () => {
        expect(parseBaseBundleAssetsRoute(request('/base-bundle/assets/'))).toBeNull();
        expect(parseBaseBundleAssetsRoute(request('/base-bundle/assets/..'))).toBeNull();
        expect(parseBaseBundleAssetsRoute(request('/base-bundle/assets/%2e%2e/secret'))).toBeNull();
    });
});

describe('handleBaseBundleAssetsRoute', () => {
    test('returns the asset body with immutable cache headers on a hit', async () => {
        const bucket = makeBucket({
            'assets/logo.png': makeAsset('logo-bytes', 'image/png'),
        });

        const response = await handleBaseBundleAssetsRoute(
            request('/base-bundle/assets/logo.png'),
            makeEnv(bucket),
        );

        expect(response.status).toBe(200);
        expect(response.headers.get('Content-Type')).toBe('image/png');
        expect(response.headers.get('Cache-Control')).toBe('public, max-age=31536000, immutable');
        expect(await response.text()).toBe('logo-bytes');
    });

    test('returns 404 when the asset is missing', async () => {
        const response = await handleBaseBundleAssetsRoute(
            request('/base-bundle/assets/missing.js'),
            makeEnv(),
        );

        expect(response.status).toBe(404);
        expect(await response.text()).toBe('expo-relay: asset not found');
    });

    test('returns 400 for traversal or empty asset keys', async () => {
        const response = await handleBaseBundleAssetsRoute(
            request('/base-bundle/assets/../secret.js'),
            makeEnv(),
        );

        expect(response.status).toBe(400);
        expect(await response.text()).toBe('expo-relay: invalid base-bundle asset key');
    });

    // ─── HEAD method (asset-check protocol, task #65) ───────────────────────
    test('HEAD on an existing asset returns 200 with headers + empty body', async () => {
        const bucket = makeBucket({
            'assets/logo.png': makeAsset('logo-bytes', 'image/png'),
        });
        const response = await handleBaseBundleAssetsRoute(
            request('/base-bundle/assets/logo.png', 'HEAD'),
            makeEnv(bucket),
        );
        expect(response.status).toBe(200);
        expect(response.headers.get('Content-Type')).toBe('image/png');
        expect(response.headers.get('Cache-Control')).toBe('public, max-age=31536000, immutable');
        // Body should be empty for HEAD per HTTP spec.
        expect(await response.text()).toBe('');
    });

    test('HEAD on a missing asset returns 404 with empty body', async () => {
        const response = await handleBaseBundleAssetsRoute(
            request('/base-bundle/assets/missing.js', 'HEAD'),
            makeEnv(),
        );
        expect(response.status).toBe(404);
        expect(await response.text()).toBe('');
    });

    test('HEAD on a traversal path returns 400', async () => {
        const response = await handleBaseBundleAssetsRoute(
            request('/base-bundle/assets/../secret.js', 'HEAD'),
            makeEnv(),
        );
        expect(response.status).toBe(400);
    });

    test('rejects POST/DELETE/PATCH with 405 + Allow: GET, HEAD, PUT', async () => {
        for (const method of ['POST', 'DELETE', 'PATCH'] as const) {
            const response = await handleBaseBundleAssetsRoute(
                request('/base-bundle/assets/logo.png', method),
                makeEnv(),
            );
            expect(response.status).toBe(405);
            expect(response.headers.get('Allow')).toBe('GET, HEAD, PUT');
        }
    });

    test('HEAD falls back to .get() when bucket binding lacks .head() (older R2 binding)', async () => {
        // Construct a bucket without .head() — only .get() is available.
        const bucketWithoutHead = {
            async get(key: string): Promise<MockAsset | null> {
                return key === 'assets/x.png' ? makeAsset('x', 'image/png') : null;
            },
        } as R2Bucket;
        const response = await handleBaseBundleAssetsRoute(
            request('/base-bundle/assets/x.png', 'HEAD'),
            makeEnv(bucketWithoutHead),
        );
        expect(response.status).toBe(200);
        expect(response.headers.get('Content-Type')).toBe('image/png');
        expect(await response.text()).toBe('');
    });

    // ─── PUT method (durable asset fallback, task #74) ──────────────────────
    test('PUT writes asset bytes to R2 and returns 201 on first write', async () => {
        const putCalls: PutCall[] = [];
        const bucket = makeBucket({}, putCalls);
        const body = new Uint8Array([1, 2, 3, 4]);
        const response = await handleBaseBundleAssetsRoute(
            request('/base-bundle/assets/upload.bin', 'PUT', {
                body,
                headers: { 'Content-Type': 'application/octet-stream' },
            }),
            makeEnv(bucket),
        );
        expect(response.status).toBe(201);
        expect(putCalls).toHaveLength(1);
        expect(putCalls[0]?.key).toBe('assets/upload.bin');
        expect(putCalls[0]?.contentType).toBe('application/octet-stream');
        expect(Array.from(putCalls[0]?.bytes ?? [])).toEqual([1, 2, 3, 4]);
    });

    test('PUT on an existing asset returns 200 (overwrite semantics)', async () => {
        const putCalls: PutCall[] = [];
        const bucket = makeBucket(
            { 'assets/exists.png': makeAsset('old', 'image/png') },
            putCalls,
        );
        const response = await handleBaseBundleAssetsRoute(
            request('/base-bundle/assets/exists.png', 'PUT', {
                body: new Uint8Array([9, 9, 9]),
                headers: { 'Content-Type': 'image/png' },
            }),
            makeEnv(bucket),
        );
        expect(response.status).toBe(200);
        expect(putCalls).toHaveLength(1);
    });

    test('PUT preserves the request Content-Type for later GET responses', async () => {
        const putCalls: PutCall[] = [];
        const bucket = makeBucket({}, putCalls);
        await handleBaseBundleAssetsRoute(
            request('/base-bundle/assets/font.woff2', 'PUT', {
                body: new Uint8Array([1, 2]),
                headers: { 'Content-Type': 'font/woff2' },
            }),
            makeEnv(bucket),
        );
        expect(putCalls[0]?.contentType).toBe('font/woff2');
        // GET should now serve it back with that Content-Type.
        const get = await handleBaseBundleAssetsRoute(
            request('/base-bundle/assets/font.woff2'),
            makeEnv(bucket),
        );
        expect(get.status).toBe(200);
        expect(get.headers.get('Content-Type')).toBe('font/woff2');
    });

    test('PUT defaults Content-Type to application/octet-stream when header is absent', async () => {
        const putCalls: PutCall[] = [];
        const bucket = makeBucket({}, putCalls);
        await handleBaseBundleAssetsRoute(
            request('/base-bundle/assets/x.bin', 'PUT', {
                body: new Uint8Array([1]),
            }),
            makeEnv(bucket),
        );
        expect(putCalls[0]?.contentType).toBe('application/octet-stream');
    });

    test('PUT empty body returns 400', async () => {
        const response = await handleBaseBundleAssetsRoute(
            request('/base-bundle/assets/x.bin', 'PUT', {
                body: new Uint8Array(0),
            }),
            makeEnv(),
        );
        expect(response.status).toBe(400);
        expect(await response.text()).toBe('expo-relay: empty asset body');
    });

    test('PUT body over 10 MB cap returns 413', async () => {
        const overSized = new Uint8Array(10 * 1024 * 1024 + 1);
        const response = await handleBaseBundleAssetsRoute(
            request('/base-bundle/assets/big.bin', 'PUT', { body: overSized }),
            makeEnv(),
        );
        expect(response.status).toBe(413);
        expect(await response.text()).toBe('expo-relay: asset body exceeds 10 MB cap');
    });

    test('PUT on a traversal path returns 400 (parsed before put)', async () => {
        const response = await handleBaseBundleAssetsRoute(
            request('/base-bundle/assets/../escape.bin', 'PUT', {
                body: new Uint8Array([1]),
            }),
            makeEnv(),
        );
        expect(response.status).toBe(400);
    });

    test('PUT failure (R2 throw) returns 502 with reason', async () => {
        const failingBucket = {
            async get() {
                return null;
            },
            async head() {
                return null;
            },
            async put(): Promise<R2Object | null> {
                throw new Error('r2 simulated failure');
            },
        } as unknown as R2Bucket;
        const response = await handleBaseBundleAssetsRoute(
            request('/base-bundle/assets/x.bin', 'PUT', {
                body: new Uint8Array([1]),
            }),
            makeEnv(failingBucket),
        );
        expect(response.status).toBe(502);
        expect(await response.text()).toContain('r2 simulated failure');
    });
});

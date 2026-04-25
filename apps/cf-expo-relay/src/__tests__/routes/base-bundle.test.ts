/// <reference types="bun" />
import { describe, expect, test } from 'bun:test';

import { handleBaseBundle } from '../../routes/base-bundle';
import type { BaseBundleRouteEnv } from '../../env';

const HASH =
    'c6a1fbc03d4e7f1234567890abcdef0123456789abcdef0123456789abcdef01';

interface StoredObject {
    body: Uint8Array;
}

interface BaseBundleLookupResult {
    bucket: BaseBundleRouteEnv['BASE_BUNDLES'];
    calls: string[];
}

function makeBaseBundlesStub(map: Record<string, StoredObject>): BaseBundleLookupResult {
    const calls: string[] = [];
    const bucket = {
        async get(key: string): Promise<{ body: ReadableStream<Uint8Array> } | null> {
            calls.push(key);
            const entry = map[key];
            if (!entry) {
                return null;
            }

            return {
                body: new ReadableStream<Uint8Array>({
                    start(controller) {
                        controller.enqueue(entry.body);
                        controller.close();
                    },
                }),
            };
        },
    };

    return {
        bucket: bucket as unknown as BaseBundleRouteEnv['BASE_BUNDLES'],
        calls,
    };
}

function envWith(bucket: BaseBundleRouteEnv['BASE_BUNDLES']): BaseBundleRouteEnv {
    return {
        BUNDLES: {} as KVNamespace,
        BASE_BUNDLES: bucket,
        EXPO_SESSION: {} as BaseBundleRouteEnv['EXPO_SESSION'],
        ESM_CACHE_URL: 'https://cf-esm-cache.dev.workers.dev',
    };
}

function makeRequest(path: string, method = 'GET'): Request {
    return new Request(`https://expo-relay.dev.workers.dev${path}`, { method });
}

function jsBytes(source: string): Uint8Array {
    return new TextEncoder().encode(source);
}

describe('handleBaseBundle', () => {
    test('returns 404 when the route has extra path segments', async () => {
        const { bucket, calls } = makeBaseBundlesStub({});
        const response = await handleBaseBundle(
            makeRequest(`/base-bundle/${HASH}/extra`),
            envWith(bucket),
        );

        expect(response.status).toBe(404);
        expect(calls).toHaveLength(0);
    });

    test('returns 400 when the bundle key is not a content hash', async () => {
        const { bucket, calls } = makeBaseBundlesStub({});
        const response = await handleBaseBundle(
            makeRequest('/base-bundle/not-a-hash'),
            envWith(bucket),
        );

        expect(response.status).toBe(400);
        expect(calls).toHaveLength(0);
    });

    test('returns 404 when the immutable base bundle is missing', async () => {
        const { bucket, calls } = makeBaseBundlesStub({});
        const response = await handleBaseBundle(
            makeRequest(`/base-bundle/${HASH}`),
            envWith(bucket),
        );

        expect(response.status).toBe(404);
        expect(calls).toEqual([HASH]);
    });

    test('returns application/javascript with long immutable cache headers on hits', async () => {
        const { bucket, calls } = makeBaseBundlesStub({
            [HASH]: { body: jsBytes('globalThis.__baseBundle = true;\n') },
        });
        const response = await handleBaseBundle(
            makeRequest(`/base-bundle/${HASH}`),
            envWith(bucket),
        );

        expect(response.status).toBe(200);
        expect(response.headers.get('Content-Type')).toBe('application/javascript');
        expect(response.headers.get('Cache-Control')).toBe(
            'public, max-age=31536000, immutable',
        );
        expect(response.headers.get('ETag')).toBe(`"${HASH}"`);
        expect(calls).toEqual([HASH]);

        const body = new Uint8Array(await response.arrayBuffer());
        expect(new TextDecoder().decode(body)).toBe('globalThis.__baseBundle = true;\n');
    });

    test('returns an empty body for HEAD requests', async () => {
        const { bucket } = makeBaseBundlesStub({
            [HASH]: { body: jsBytes('console.log("hi");\n') },
        });
        const response = await handleBaseBundle(
            makeRequest(`/base-bundle/${HASH}`, 'HEAD'),
            envWith(bucket),
        );

        expect(response.status).toBe(200);
        expect(response.headers.get('Content-Type')).toBe('application/javascript');
        expect(await response.text()).toBe('');
    });
});

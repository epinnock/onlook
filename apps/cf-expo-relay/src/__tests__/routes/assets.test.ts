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

function makeBucket(entries: Record<string, MockAsset | undefined> = {}): R2Bucket {
    return {
        async get(key: string): Promise<MockAsset | null> {
            return entries[key] ?? null;
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

function request(pathname: string, method = 'GET'): Request {
    return new Request(`https://expo-relay.dev.workers.dev${pathname}`, { method });
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
});

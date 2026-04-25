import { describe, expect, test } from 'bun:test';

import {
    createBaseBundleAssetManifest,
    normalizeBaseBundleAssetKey,
} from '../src/assets';

describe('base bundle asset manifest extraction', () => {
    test('extracts assets from structural build output and metadata inputs', () => {
        const manifest = createBaseBundleAssetManifest({
            buildOutput: {
                assets: [
                    {
                        path: 'images/icon.png',
                        hash: 'f00d1234',
                        contentType: 'image/png',
                        byteLength: 128,
                    },
                ],
            },
            metadata: {
                assets: [
                    {
                        path: 'fonts/nested/Inter-Bold.ttf',
                        key: 'c0ffee99',
                        contentType: 'font/ttf',
                        byteLength: 4096,
                    },
                ],
            },
        });

        expect(manifest).toEqual({
            assets: [
                {
                    path: 'images/icon.png',
                    key: 'assets/f00d1234/icon.png',
                    contentType: 'image/png',
                    byteLength: 128,
                },
                {
                    path: 'fonts/nested/Inter-Bold.ttf',
                    key: 'assets/c0ffee99/Inter-Bold.ttf',
                    contentType: 'font/ttf',
                    byteLength: 4096,
                },
            ],
        });
    });

    test('normalizes asset keys to immutable assets/hash/filename paths', () => {
        expect(
            normalizeBaseBundleAssetKey({
                path: 'assets/screens/home image@2x.png',
                hash: 'abc123def456',
            }),
        ).toBe('assets/abc123def456/home image@2x.png');
    });

    test('rejects empty or traversal asset paths', () => {
        expect(() =>
            normalizeBaseBundleAssetKey({
                path: '',
                hash: 'abc123',
            }),
        ).toThrow('Base bundle asset path must be a non-empty string');

        expect(() =>
            normalizeBaseBundleAssetKey({
                path: '../icon.png',
                hash: 'abc123',
            }),
        ).toThrow('without traversal');

        expect(() =>
            createBaseBundleAssetManifest({
                buildOutput: {
                    assets: [
                        {
                            path: 'icons/../icon.png',
                            hash: 'abc123',
                            contentType: 'image/png',
                            byteLength: 12,
                        },
                    ],
                },
            }),
        ).toThrow('without traversal');
    });
});

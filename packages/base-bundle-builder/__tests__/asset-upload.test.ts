import { describe, expect, test } from 'bun:test';

import { createBaseBundleAssetManifest } from '../src/assets';
import { uploadBaseBundleAssets, type BaseBundleAssetUploadEntry } from '../src/asset-upload';

describe('base bundle asset upload wiring', () => {
    test('uploads multiple assets and returns uploaded counts and urls', async () => {
        const manifest = createBaseBundleAssetManifest({
            buildOutput: {
                assets: [
                    {
                        path: 'images/icon.png',
                        hash: 'f00d1234',
                        contentType: 'image/png',
                        byteLength: 128,
                    },
                    {
                        path: 'fonts/Inter-Bold.ttf',
                        key: 'c0ffee99',
                        contentType: 'font/ttf',
                        byteLength: 4096,
                    },
                ],
            },
        });

        const calls: BaseBundleAssetUploadEntry[] = [];
        const result = await uploadBaseBundleAssets({
            manifest,
            uploadAsset: async (asset) => {
                calls.push({
                    ...asset,
                    key: asset.key,
                    url: `https://cdn.example.com/${asset.key}`,
                    path: `/bucket/${asset.key}`,
                    uploaded: true,
                });

                return {
                    key: asset.key,
                    url: `https://cdn.example.com/${asset.key}`,
                    path: `/bucket/${asset.key}`,
                    uploaded: true,
                };
            },
        });

        expect(calls).toHaveLength(2);
        expect(result).toEqual({
            uploadedCount: 2,
            skippedCount: 0,
            assets: [
                {
                    path: 'images/icon.png',
                    key: 'assets/f00d1234/icon.png',
                    contentType: 'image/png',
                    byteLength: 128,
                    url: 'https://cdn.example.com/assets/f00d1234/icon.png',
                    uploaded: true,
                },
                {
                    path: 'fonts/Inter-Bold.ttf',
                    key: 'assets/c0ffee99/Inter-Bold.ttf',
                    contentType: 'font/ttf',
                    byteLength: 4096,
                    url: 'https://cdn.example.com/assets/c0ffee99/Inter-Bold.ttf',
                    uploaded: true,
                },
            ],
        });
    });

    test('counts existing assets as skipped', async () => {
        const manifest = createBaseBundleAssetManifest({
            metadata: {
                assets: [
                    {
                        path: 'images/existing.png',
                        hash: 'bada55',
                        contentType: 'image/png',
                        byteLength: 64,
                    },
                ],
            },
        });

        const result = await uploadBaseBundleAssets({
            manifest,
            uploadAsset: async (asset) => ({
                key: asset.key,
                url: `https://cdn.example.com/${asset.key}`,
                path: `/bucket/${asset.key}`,
                uploaded: false,
            }),
        });

        expect(result).toEqual({
            uploadedCount: 0,
            skippedCount: 1,
            assets: [
                {
                    path: 'images/existing.png',
                    key: 'assets/bada55/existing.png',
                    contentType: 'image/png',
                    byteLength: 64,
                    url: 'https://cdn.example.com/assets/bada55/existing.png',
                    uploaded: false,
                },
            ],
        });
    });

    test('returns an empty manifest without calling the uploader', async () => {
        let calls = 0;

        const result = await uploadBaseBundleAssets({
            manifest: { assets: [] },
            uploadAsset: async () => {
                calls += 1;
                return {
                    key: 'unused',
                    url: 'https://cdn.example.com/unused',
                    path: '/bucket/unused',
                    uploaded: true,
                };
            },
        });

        expect(calls).toBe(0);
        expect(result).toEqual({
            uploadedCount: 0,
            skippedCount: 0,
            assets: [],
        });
    });
});

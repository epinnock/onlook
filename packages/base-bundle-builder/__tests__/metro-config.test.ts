import { describe, expect, test } from 'bun:test';

import { createBaseBundleBuildOptions } from '../src/options';
import { createBaseBundleMetroConfig } from '../src/metro-config';

describe('base bundle metro config', () => {
    test('roots the config at the build project', () => {
        const config = createBaseBundleMetroConfig(
            createBaseBundleBuildOptions({
                projectRoot: '/repo/fixture',
                outputDir: '/tmp/base-bundle',
            }),
        );

        expect(config.projectRoot).toBe('/repo/fixture');
        expect(config.watchFolders).toEqual([
            '/repo/fixture',
            '/tmp/base-bundle',
        ]);
        expect(config.resolver.nodeModulesPaths).toEqual([
            '/repo/fixture/node_modules',
        ]);
    });

    test('propagates platform, dev, and minify settings', () => {
        const config = createBaseBundleMetroConfig(
            createBaseBundleBuildOptions({
                projectRoot: '/repo/fixture',
                outputDir: '/tmp/base-bundle',
                platform: 'android',
                dev: true,
                minify: false,
            }),
        );

        expect(config.platform).toBe('android');
        expect(config.dev).toBe(true);
        expect(config.minify).toBe(false);
        expect(config.resolver.platforms).toEqual(['android']);
        expect(config.transformer.dev).toBe(true);
        expect(config.transformer.minify).toBe(false);
        expect(config.transformer.inlineRequires).toBe(false);
    });

    test('only enables cache stores when a cacheDir is provided', () => {
        const configWithoutCacheDir = createBaseBundleMetroConfig(
            createBaseBundleBuildOptions({
                projectRoot: '/repo/fixture',
                outputDir: '/tmp/base-bundle',
            }),
        );

        expect(configWithoutCacheDir.cacheDir).toBeUndefined();
        expect(configWithoutCacheDir.cacheStores).toBeUndefined();

        const configWithCacheDir = createBaseBundleMetroConfig(
            createBaseBundleBuildOptions({
                projectRoot: '/repo/fixture',
                outputDir: '/tmp/base-bundle',
                cacheDir: '/tmp/metro-cache',
            }),
        );

        expect(configWithCacheDir.cacheDir).toBe('/tmp/metro-cache');
        expect(configWithCacheDir.cacheStores).toEqual([
            {
                type: 'fs',
                root: '/tmp/metro-cache',
            },
        ]);
        expect(configWithCacheDir.cacheVersion).toBe(
            'base-bundle-metro:ios:prod:minify',
        );
    });
});

import { describe, expect, test } from 'bun:test';

import {
    createBaseBundleBuildOptions,
    isBaseBundlePlatform,
} from '../src/options';

describe('base bundle build options', () => {
    test('normalizes default values', () => {
        expect(
            createBaseBundleBuildOptions({
                projectRoot: '/repo/fixture',
                outputDir: '/tmp/base-bundle',
            }),
        ).toEqual({
            projectRoot: '/repo/fixture',
            outputDir: '/tmp/base-bundle',
            platform: 'ios',
            dev: false,
            minify: true,
            cacheDir: undefined,
        });
    });

    test('preserves explicit values', () => {
        expect(
            createBaseBundleBuildOptions({
                projectRoot: '/repo/fixture',
                outputDir: '/tmp/base-bundle',
                platform: 'android',
                dev: true,
                minify: false,
                cacheDir: '/tmp/metro-cache',
            }),
        ).toEqual({
            projectRoot: '/repo/fixture',
            outputDir: '/tmp/base-bundle',
            platform: 'android',
            dev: true,
            minify: false,
            cacheDir: '/tmp/metro-cache',
        });
    });

    test('validates required paths', () => {
        expect(() =>
            createBaseBundleBuildOptions({
                projectRoot: ' ',
                outputDir: '/tmp/base-bundle',
            }),
        ).toThrow('projectRoot');

        expect(() =>
            createBaseBundleBuildOptions({
                projectRoot: '/repo/fixture',
                outputDir: '',
            }),
        ).toThrow('outputDir');
    });

    test('checks supported platforms', () => {
        expect(isBaseBundlePlatform('ios')).toBe(true);
        expect(isBaseBundlePlatform('android')).toBe(true);
        expect(isBaseBundlePlatform('web')).toBe(false);
    });
});

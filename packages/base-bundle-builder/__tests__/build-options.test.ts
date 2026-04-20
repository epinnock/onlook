import { describe, expect, test } from 'bun:test';

import { normalizeBaseBundleBuildOptions } from '../src/build-options';

describe('base bundle build option normalization', () => {
    test('normalizes relative paths against cwd', () => {
        expect(
            normalizeBaseBundleBuildOptions({
                cwd: '/repo',
                projectRoot: 'fixtures/hello',
                outputDir: 'dist/base',
                cacheDir: '.cache/metro',
            }),
        ).toEqual({
            projectRoot: '/repo/fixtures/hello',
            outputDir: '/repo/dist/base',
            platform: 'ios',
            dev: false,
            minify: true,
            cacheDir: '/repo/.cache/metro',
        });
    });

    test('preserves explicit platform and transform flags', () => {
        expect(
            normalizeBaseBundleBuildOptions({
                cwd: '/repo',
                projectRoot: '/repo/app',
                outputDir: '/tmp/out',
                platform: 'android',
                dev: true,
                minify: false,
            }),
        ).toEqual({
            projectRoot: '/repo/app',
            outputDir: '/tmp/out',
            platform: 'android',
            dev: true,
            minify: false,
            cacheDir: undefined,
        });
    });

    test('reuses option contract validation', () => {
        expect(() =>
            normalizeBaseBundleBuildOptions({
                cwd: '/repo',
                projectRoot: '',
                outputDir: 'dist',
            }),
        ).toThrow('projectRoot');
    });
});

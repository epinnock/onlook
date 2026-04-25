import { describe, expect, test } from 'bun:test';

import {
    BASE_BUNDLE_BUILD_COMMAND,
    createBaseBundleCliErrorText,
    createBaseBundleCliHelpText,
    parseBaseBundleCliArgs,
} from '../src/cli';

describe('base bundle cli parser', () => {
    test('parses valid args', () => {
        expect(
            parseBaseBundleCliArgs([
                BASE_BUNDLE_BUILD_COMMAND,
                '--project-root',
                'apps/demo',
                '--out',
                'dist/base-bundle',
                '--platform',
                'android',
                '--dev',
                '--no-minify',
                '--cache-dir',
                '.metro-cache',
            ]),
        ).toEqual({
            projectRoot: 'apps/demo',
            outputDir: 'dist/base-bundle',
            platform: 'android',
            dev: true,
            minify: false,
            cacheDir: '.metro-cache',
        });
    });

    test('applies defaults', () => {
        expect(
            parseBaseBundleCliArgs([
                BASE_BUNDLE_BUILD_COMMAND,
                '--project-root',
                'apps/demo',
                '--out',
                'dist/base-bundle',
            ]),
        ).toEqual({
            projectRoot: 'apps/demo',
            outputDir: 'dist/base-bundle',
            platform: 'ios',
            dev: false,
            minify: true,
        });
    });

    test('rejects an invalid platform', () => {
        expect(() =>
            parseBaseBundleCliArgs([
                BASE_BUNDLE_BUILD_COMMAND,
                '--project-root',
                'apps/demo',
                '--out',
                'dist/base-bundle',
                '--platform',
                'web',
            ]),
        ).toThrow(/Invalid platform "web"/);
    });

    test('rejects missing required values', () => {
        expect(() =>
            parseBaseBundleCliArgs([
                BASE_BUNDLE_BUILD_COMMAND,
                '--out',
                'dist/base-bundle',
            ]),
        ).toThrow(/Missing required option --project-root/);

        expect(() =>
            parseBaseBundleCliArgs([
                BASE_BUNDLE_BUILD_COMMAND,
                '--project-root',
                'apps/demo',
            ]),
        ).toThrow(/Missing required option --out/);
    });

    test('exposes help and error text helpers', () => {
        expect(createBaseBundleCliHelpText()).toContain(BASE_BUNDLE_BUILD_COMMAND);
        expect(createBaseBundleCliErrorText('bad input')).toContain('bad input');
    });
});

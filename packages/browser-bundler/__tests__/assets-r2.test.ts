import { describe, expect, test } from 'bun:test';

import {
    createAssetsR2Plugin,
    createImmutableAssetUrl,
    createR2AssetModule,
    type EsbuildLoadBuild,
    type EsbuildLoadResult,
} from '../src/plugins/assets-r2';

function createPluginHarness(files: Record<string, string | Uint8Array>, maxInlineBytes: number) {
    let callback:
        | ((args: { path: string; namespace?: string }) => EsbuildLoadResult | undefined | void)
        | undefined;
    let filter: RegExp | undefined;

    const build: EsbuildLoadBuild = {
        onLoad(options, handler) {
            filter = options.filter;
            callback = handler;
        },
    };

    createAssetsR2Plugin({
        files,
        baseAssetUrl: 'https://cdn.example.com/assets/',
        maxInlineBytes,
        assetKey: ({ path }) => `asset key/${path}?#`,
    }).setup(build);

    if (callback === undefined || filter === undefined) {
        throw new Error('plugin did not register an onLoad handler');
    }

    return {
        filter,
        load(path: string) {
            return callback?.({ path });
        },
    };
}

describe('assets r2 plugin', () => {
    test('creates immutable URLs from the base asset url and the injected key', () => {
        expect(
            createImmutableAssetUrl('https://cdn.example.com/assets/', 'asset key/folder name/image?#.png'),
        ).toBe('https://cdn.example.com/assets/asset%20key/folder%20name/image%3F%23.png');
    });

    test('rewrites large assets as js modules exporting r2 urls', () => {
        const result = createR2AssetModule({
            contents: new Uint8Array([0, 1, 2, 3]),
            path: 'assets/icon.png',
            baseAssetUrl: 'https://cdn.example.com/assets/',
            maxInlineBytes: 3,
            assetKey: ({ path }) => `asset key/${path}?#`,
        });

        expect(result).toEqual({
            contents: 'export default "https://cdn.example.com/assets/asset%20key/assets/icon.png%3F%23";',
            loader: 'js',
        });
    });

    test('skips assets at or below the inline threshold', () => {
        const result = createR2AssetModule({
            contents: new Uint8Array([0, 1, 2]),
            path: 'assets/icon.png',
            baseAssetUrl: 'https://cdn.example.com/assets/',
            maxInlineBytes: 3,
            assetKey: ({ path }) => `asset key/${path}?#`,
        });

        expect(result).toBeUndefined();
    });

    test('skips plugin loads for non-asset and code files', () => {
        const harness = createPluginHarness(
            {
                'assets/icon.png': new Uint8Array([0, 1, 2, 3]),
                'src/app.ts': 'export const app = true;',
                'notes/readme.txt': 'ignore me',
            },
            3,
        );

        expect(harness.filter.test('assets/icon.png')).toBe(true);
        expect(harness.filter.test('src/app.ts')).toBe(false);
        expect(harness.filter.test('notes/readme.txt')).toBe(false);

        expect(harness.load('assets/icon.png')).toEqual({
            contents: 'export default "https://cdn.example.com/assets/asset%20key/assets/icon.png%3F%23";',
            loader: 'js',
        });

        expect(harness.load('src/app.ts')).toBeUndefined();
        expect(harness.load('notes/readme.txt')).toBeUndefined();
    });
});

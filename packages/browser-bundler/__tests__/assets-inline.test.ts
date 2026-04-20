import { describe, expect, test } from 'bun:test';

import {
    createAssetsInlinePlugin,
    createInlineAssetModule,
    inferAssetMimeType,
    type EsbuildLoadBuild,
    type EsbuildLoadResult,
} from '../src/plugins/assets-inline';

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

    createAssetsInlinePlugin({ files, maxInlineBytes }).setup(build);

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

describe('assets inline plugin', () => {
    test('infers png, svg, and font mime types', () => {
        expect(inferAssetMimeType('icon.png')).toBe('image/png');
        expect(inferAssetMimeType('icon.svg')).toBe('image/svg+xml');
        expect(inferAssetMimeType('font.woff2')).toBe('font/woff2');
    });

    test('inlines small assets as js data url modules', () => {
        const result = createInlineAssetModule({
            contents: new Uint8Array([0, 1, 2]),
            path: 'assets/icon.png',
            maxInlineBytes: 3,
        });

        expect(result).toEqual({
            contents: 'export default "data:image/png;base64,AAEC";',
            loader: 'js',
        });
    });

    test('skips assets over the size threshold', () => {
        const result = createInlineAssetModule({
            contents: new Uint8Array([0, 1, 2, 3]),
            path: 'assets/icon.png',
            maxInlineBytes: 3,
        });

        expect(result).toBeUndefined();
    });

    test('returns undefined for unsupported asset types', () => {
        const result = createInlineAssetModule({
            contents: 'noop',
            path: 'assets/icon.txt',
            maxInlineBytes: 16,
        });

        expect(result).toBeUndefined();
    });

    test('loads virtual assets through the plugin using the provided file contents', () => {
        const harness = createPluginHarness(
            {
                'assets/icon.svg': '<svg/>',
            },
            32,
        );

        expect(harness.filter.test('assets/icon.svg')).toBe(true);

        expect(harness.load('assets/icon.svg')).toEqual({
            contents: 'export default "data:image/svg+xml;base64,PHN2Zy8+";',
            loader: 'js',
        });
    });

    test('skips plugin loads over the limit so later plugins can handle them', () => {
        const harness = createPluginHarness(
            {
                'assets/font.woff2': new Uint8Array([0, 1, 2, 3]),
            },
            3,
        );

        expect(harness.load('assets/font.woff2')).toBeUndefined();
    });
});

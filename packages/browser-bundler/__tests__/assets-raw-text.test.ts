import { describe, expect, test } from 'bun:test';

import {
    createAssetsRawTextPlugin,
    loadRawTextAsset,
    parseRawTextSpecifier,
    type EsbuildLoadBuild,
    type EsbuildLoadResult,
    type RawTextAssetFileMap,
} from '../src/plugins/assets-raw-text';

function createPluginHarness(
    files: RawTextAssetFileMap,
    textExtensions?: readonly string[],
) {
    let callback:
        | ((args: { path: string; namespace?: string; suffix?: string }) => EsbuildLoadResult | undefined | void)
        | undefined;
    let filter: RegExp | undefined;

    const build: EsbuildLoadBuild = {
        onLoad(options, handler) {
            filter = options.filter;
            callback = handler;
        },
    };

    createAssetsRawTextPlugin({ files, textExtensions }).setup(build);

    if (callback === undefined || filter === undefined) {
        throw new Error('plugin did not register an onLoad handler');
    }

    return {
        filter,
        load(path: string, suffix?: string) {
            return callback?.({ path, suffix });
        },
    };
}

describe('parseRawTextSpecifier', () => {
    test('no query → hasRawQuery is false, path is unchanged', () => {
        expect(parseRawTextSpecifier('file.md')).toEqual({
            pathWithoutQuery: 'file.md',
            hasRawQuery: false,
        });
    });

    test('?raw suffix → hasRawQuery is true, pathWithoutQuery drops the query', () => {
        expect(parseRawTextSpecifier('icon.svg?raw')).toEqual({
            pathWithoutQuery: 'icon.svg',
            hasRawQuery: true,
        });
    });

    test('non-raw query → hasRawQuery is false', () => {
        expect(parseRawTextSpecifier('icon.svg?url')).toEqual({
            pathWithoutQuery: 'icon.svg',
            hasRawQuery: false,
        });
    });

    test('?raw among other query params is detected', () => {
        expect(parseRawTextSpecifier('x.txt?v=1&raw')).toEqual({
            pathWithoutQuery: 'x.txt',
            hasRawQuery: true,
        });
        expect(parseRawTextSpecifier('x.txt?raw&v=2')).toEqual({
            pathWithoutQuery: 'x.txt',
            hasRawQuery: true,
        });
    });

    test('raw as a substring of another token is NOT matched', () => {
        expect(parseRawTextSpecifier('x.txt?draw=yes')).toEqual({
            pathWithoutQuery: 'x.txt',
            hasRawQuery: false,
        });
    });
});

describe('loadRawTextAsset', () => {
    test('returns JS-module string export for a default text extension', () => {
        const result = loadRawTextAsset({
            files: { 'docs/readme.md': '# hello\nworld' },
            textExtensions: ['.md'],
            path: 'docs/readme.md',
        });
        expect(result).toEqual({
            contents: 'export default "# hello\\nworld";',
            loader: 'js',
        });
    });

    test('returns undefined when extension is not a default text extension AND no ?raw', () => {
        const result = loadRawTextAsset({
            files: { 'icon.svg': '<svg/>' },
            textExtensions: ['.txt'],
            path: 'icon.svg',
        });
        expect(result).toBeUndefined();
    });

    test('?raw query forces raw-text loading for any extension in filter', () => {
        const result = loadRawTextAsset({
            files: { 'icon.svg': '<svg viewBox="0 0 1 1" />' },
            textExtensions: ['.txt'],
            path: 'icon.svg?raw',
        });
        expect(result?.contents).toBe(
            'export default "<svg viewBox=\\"0 0 1 1\\" />";',
        );
    });

    test('esbuild suffix "?raw" also forces raw-text loading', () => {
        const result = loadRawTextAsset({
            files: { 'icon.svg': '<svg/>' },
            textExtensions: [],
            path: 'icon.svg',
            suffix: '?raw',
        });
        expect(result?.contents).toBe('export default "<svg/>";');
    });

    test('Uint8Array contents are UTF-8 decoded before JSON-encoding', () => {
        // "héllo" as UTF-8 bytes.
        const bytes = new Uint8Array([0x68, 0xc3, 0xa9, 0x6c, 0x6c, 0x6f]);
        const result = loadRawTextAsset({
            files: { 'msg.txt': bytes },
            textExtensions: ['.txt'],
            path: 'msg.txt',
        });
        expect(result?.contents).toBe('export default "héllo";');
    });

    test('returns undefined when extension is missing', () => {
        const result = loadRawTextAsset({
            files: { 'no-extension': 'x' },
            textExtensions: ['.txt'],
            path: 'no-extension',
        });
        expect(result).toBeUndefined();
    });

    test('returns undefined when file is not in the virtual map (asset-missing)', () => {
        const result = loadRawTextAsset({
            files: {},
            textExtensions: ['.md'],
            path: 'docs/missing.md',
        });
        expect(result).toBeUndefined();
    });

    test('normalizes backslashes and leading slash in the lookup path', () => {
        const files = { 'docs/readme.md': '# ok' };
        expect(
            loadRawTextAsset({ files, textExtensions: ['.md'], path: '\\docs\\readme.md' })
                ?.contents,
        ).toBe('export default "# ok";');
        expect(
            loadRawTextAsset({ files, textExtensions: ['.md'], path: '/docs/readme.md' })
                ?.contents,
        ).toBe('export default "# ok";');
    });

    test('JSON.stringify escapes internal quotes + newlines so output is parseable', () => {
        const tricky = 'line1\nline2 "with quotes" and \\ backslash';
        const result = loadRawTextAsset({
            files: { 'quirks.txt': tricky },
            textExtensions: ['.txt'],
            path: 'quirks.txt',
        });
        // Remove the `export default ` prefix and `;` suffix, parse as JSON.
        const jsonPart = result!.contents!.replace(/^export default /, '').replace(/;$/, '');
        expect(JSON.parse(jsonPart)).toBe(tricky);
    });
});

describe('createAssetsRawTextPlugin', () => {
    test('filter matches every default text extension', () => {
        const harness = createPluginHarness({});
        for (const ext of ['.txt', '.md', '.html', '.glsl', '.frag', '.vert', '.csv', '.tsv']) {
            expect(harness.filter.test(`any${ext}`)).toBe(true);
        }
    });

    test('filter matches .svg + .json + .xml because ?raw is a valid override for them', () => {
        const harness = createPluginHarness({});
        expect(harness.filter.test('icon.svg')).toBe(true);
        expect(harness.filter.test('icon.svg?raw')).toBe(true);
        expect(harness.filter.test('data.json')).toBe(true);
        expect(harness.filter.test('atom.xml')).toBe(true);
    });

    test('filter does NOT match code files', () => {
        const harness = createPluginHarness({});
        expect(harness.filter.test('src/app.ts')).toBe(false);
        expect(harness.filter.test('styles.css')).toBe(false);
        expect(harness.filter.test('icon.png')).toBe(false);
    });

    test('.svg without ?raw returns undefined when SVG is not in textExtensions (delegates to image plugin)', () => {
        const harness = createPluginHarness({ 'icon.svg': '<svg/>' });
        // Default textExtensions does NOT include .svg — so `icon.svg` without
        // `?raw` must return undefined so the image asset plugins can handle it.
        expect(harness.load('icon.svg')).toBeUndefined();
        // With `?raw`, the plugin claims it.
        expect(harness.load('icon.svg?raw')).toEqual({
            contents: 'export default "<svg/>";',
            loader: 'js',
        });
    });

    test('plugin honors custom textExtensions (override default set)', () => {
        const harness = createPluginHarness(
            {
                'x.shader': 'precision mediump float;',
                'y.md': '# not claimed here',
            },
            ['.shader'],
        );
        expect(harness.filter.test('x.shader')).toBe(false); // filter matches defaults; shader still goes through JSON handler's `?raw` path ONLY if the extension matches
        // But .md is still in the filter — so harness.load will be called.
        // With textExtensions=['.shader'], '.md' is NOT an allowed extension
        // AND the path has no ?raw → should return undefined.
        expect(harness.load('y.md')).toBeUndefined();
    });
});

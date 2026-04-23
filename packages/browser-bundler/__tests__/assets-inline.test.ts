import { describe, expect, test } from 'bun:test';

import {
    createAssetsInlinePlugin,
    createInlineAssetModule,
    hasBypassQuery,
    inferAssetMimeType,
    stripQuery,
    type EsbuildLoadBuild,
    type EsbuildLoadResult,
} from '../src/plugins/assets-inline';

function createPluginHarness(files: Record<string, string | Uint8Array>, maxInlineBytes: number) {
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

    createAssetsInlinePlugin({ files, maxInlineBytes }).setup(build);

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

    // ─── Extended MIME coverage (task #68) ──────────────────────────────────
    test('infers all registered image MIME types', () => {
        expect(inferAssetMimeType('pic.jpg')).toBe('image/jpeg');
        expect(inferAssetMimeType('pic.jpeg')).toBe('image/jpeg');
        expect(inferAssetMimeType('pic.webp')).toBe('image/webp');
        expect(inferAssetMimeType('pic.gif')).toBe('image/gif');
        expect(inferAssetMimeType('pic.avif')).toBe('image/avif');
        expect(inferAssetMimeType('pic.bmp')).toBe('image/bmp');
        expect(inferAssetMimeType('favicon.ico')).toBe('image/x-icon');
    });

    test('infers all registered font MIME types', () => {
        expect(inferAssetMimeType('Inter.ttf')).toBe('font/ttf');
        expect(inferAssetMimeType('Inter.otf')).toBe('font/otf');
        expect(inferAssetMimeType('Inter.woff')).toBe('font/woff');
        expect(inferAssetMimeType('Inter.woff2')).toBe('font/woff2');
    });

    test('MIME inference is case-insensitive on the extension', () => {
        expect(inferAssetMimeType('LOGO.PNG')).toBe('image/png');
        expect(inferAssetMimeType('image.JPG')).toBe('image/jpeg');
        expect(inferAssetMimeType('Icon.WoFf2')).toBe('font/woff2');
    });

    test('MIME inference returns undefined for unregistered extensions', () => {
        expect(inferAssetMimeType('readme.txt')).toBeUndefined();
        expect(inferAssetMimeType('data.json')).toBeUndefined();
        expect(inferAssetMimeType('data.yml')).toBeUndefined();
        expect(inferAssetMimeType('noext')).toBeUndefined();
    });

    test('data URL is deterministic across repeated calls with same bytes', () => {
        // Base64 encoding is pure, so the same bytes must always produce the
        // same data-URL module output. Regression guard for any future hash-
        // based nondeterminism creeping into the inline path.
        const first = createInlineAssetModule({
            contents: new Uint8Array([10, 20, 30, 40]),
            path: 'a/b/icon.png',
            maxInlineBytes: 16,
        });
        const second = createInlineAssetModule({
            contents: new Uint8Array([10, 20, 30, 40]),
            path: 'a/b/icon.png',
            maxInlineBytes: 16,
        });
        expect(first).toEqual(second);
    });

    test('normalizes backslashes and leading slashes in asset paths', () => {
        // The plugin's filter/key logic should treat '\\assets/foo.png',
        // '/assets/foo.png', and 'assets/foo.png' as the same asset.
        const harness = createPluginHarness(
            { 'assets/icon.png': new Uint8Array([0, 1, 2]) },
            16,
        );
        expect(harness.load('\\assets\\icon.png')).toEqual({
            contents: 'export default "data:image/png;base64,AAEC";',
            loader: 'js',
        });
        expect(harness.load('/assets/icon.png')).toEqual({
            contents: 'export default "data:image/png;base64,AAEC";',
            loader: 'js',
        });
    });

    test('exact-threshold bytes are still inlined (boundary: length === maxInlineBytes)', () => {
        const bytes = new Uint8Array([1, 2, 3]);
        const result = createInlineAssetModule({
            contents: bytes,
            path: 'assets/x.png',
            maxInlineBytes: 3,
        });
        // byteLength (3) === maxInlineBytes (3) → still inlines (uses `>` check).
        expect(result).not.toBeUndefined();
        expect(result!.contents).toContain('data:image/png;base64,');
    });

    // ─── Audio + video MIME coverage (task #59) ─────────────────────────────
    test('infers audio MIME types', () => {
        expect(inferAssetMimeType('track.mp3')).toBe('audio/mpeg');
        expect(inferAssetMimeType('loop.wav')).toBe('audio/wav');
        expect(inferAssetMimeType('podcast.m4a')).toBe('audio/mp4');
        expect(inferAssetMimeType('bell.aac')).toBe('audio/aac');
        expect(inferAssetMimeType('amb.ogg')).toBe('audio/ogg');
        expect(inferAssetMimeType('archive.flac')).toBe('audio/flac');
    });

    test('infers video MIME types', () => {
        expect(inferAssetMimeType('clip.mp4')).toBe('video/mp4');
        expect(inferAssetMimeType('clip.m4v')).toBe('video/mp4');
        expect(inferAssetMimeType('record.mov')).toBe('video/quicktime');
        expect(inferAssetMimeType('stream.webm')).toBe('video/webm');
    });

    test('small audio/video assets still inline as data URLs (same code path as images)', () => {
        const result = createInlineAssetModule({
            contents: new Uint8Array([0, 1, 2]),
            path: 'sfx/ping.mp3',
            maxInlineBytes: 16,
        });
        expect(result?.contents).toBe(
            'export default "data:audio/mpeg;base64,AAEC";',
        );
    });

    // ─── ?url / ?raw bypass (task #56) ──────────────────────────────────────
    test('stripQuery drops everything after the first ?', () => {
        expect(stripQuery('icon.png')).toBe('icon.png');
        expect(stripQuery('icon.png?url')).toBe('icon.png');
        expect(stripQuery('icon.png?raw&v=1')).toBe('icon.png');
    });

    test('hasBypassQuery detects ?url and ?raw in both forms', () => {
        expect(hasBypassQuery('icon.png')).toBe(false);
        expect(hasBypassQuery('icon.png?url')).toBe(true);
        expect(hasBypassQuery('icon.png?raw')).toBe(true);
        expect(hasBypassQuery('icon.png?other')).toBe(false);
        expect(hasBypassQuery('icon.png', '?url')).toBe(true);
        expect(hasBypassQuery('icon.png', '?raw')).toBe(true);
        expect(hasBypassQuery('icon.png?v=1&raw')).toBe(true);
        expect(hasBypassQuery('icon.png?url=custom')).toBe(true);
    });

    test('?url query skips inline handoff (downstream R2 plugin picks it up)', () => {
        const harness = createPluginHarness(
            { 'icon.svg': '<svg/>' },
            1024,
        );
        // Without the query, a small svg inlines.
        expect(harness.load('icon.svg')?.contents).toContain('data:image/svg+xml');
        // With the query, the plugin returns undefined so esbuild falls through.
        expect(harness.load('icon.svg?url')).toBeUndefined();
    });

    test('?raw query also skips inline handoff', () => {
        const harness = createPluginHarness(
            { 'doc.svg': '<svg/>' },
            1024,
        );
        expect(harness.load('doc.svg?raw')).toBeUndefined();
    });

    test('esbuild suffix "?url" skips inline even when path has no query', () => {
        const harness = createPluginHarness(
            { 'icon.svg': '<svg/>' },
            1024,
        );
        expect(harness.load('icon.svg', '?url')).toBeUndefined();
    });
});

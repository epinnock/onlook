import { describe, expect, test } from 'bun:test';

import {
    buildStubModule,
    createAssetsResolvePlugin,
    createOverlayAssetManifestBuilder,
    deriveFontFamily,
    extractSvgViewBox,
    routeAssetKind,
    sha256Hex,
    type AssetDescriptor,
    type EsbuildLoadBuild,
    type EsbuildLoadResult,
    type ResolveAssetFileMap,
} from '../src/plugins/assets-resolve';

function createPluginHarness(files: ResolveAssetFileMap) {
    let callback:
        | ((args: { path: string; namespace?: string; suffix?: string }) => EsbuildLoadResult | undefined | void)
        | undefined;
    let filter: RegExp | undefined;

    const manifest = createOverlayAssetManifestBuilder();

    const build: EsbuildLoadBuild = {
        onLoad(options, handler) {
            filter = options.filter;
            callback = handler;
        },
    };

    createAssetsResolvePlugin({
        files,
        manifest,
        urlForKey: ({ path, hash }) => `https://cdn.example.com/assets/${hash}/${path}`,
    }).setup(build);

    if (callback === undefined || filter === undefined) {
        throw new Error('plugin did not register an onLoad handler');
    }

    return {
        filter,
        manifest,
        load(path: string) {
            return callback?.({ path });
        },
    };
}

describe('buildStubModule', () => {
    test('emits an export default that reads OnlookRuntime.resolveAsset', () => {
        const src = buildStubModule('image/abc123');
        expect(src).toContain('export default');
        expect(src).toContain('globalThis.OnlookRuntime');
        expect(src).toContain('typeof globalThis.OnlookRuntime.resolveAsset === "function"');
        expect(src).toContain('resolveAsset("image/abc123")');
        expect(src).toContain(': null)');
    });

    test('assetId is JSON.stringify-escaped for quoted strings', () => {
        const src = buildStubModule('weird"id');
        // JSON.stringify('weird"id') → "\"weird\\\"id\""
        expect(src).toContain('resolveAsset("weird\\"id")');
    });
});

describe('routeAssetKind', () => {
    test('routes image extensions to "image"', () => {
        for (const p of ['a.png', 'a.jpg', 'a.jpeg', 'a.webp', 'a.gif', 'a.avif', 'a.bmp', 'a.ico']) {
            expect(routeAssetKind(p)).toBe('image');
        }
    });

    test('routes font extensions to "font"', () => {
        for (const p of ['f.ttf', 'f.otf', 'f.woff', 'f.woff2']) {
            expect(routeAssetKind(p)).toBe('font');
        }
    });

    test('routes svg to "svg"', () => {
        expect(routeAssetKind('logo.svg')).toBe('svg');
    });

    test('routes audio/video extensions to "media"', () => {
        for (const p of ['a.mp3', 'a.wav', 'a.m4a', 'a.aac', 'a.ogg', 'a.flac', 'v.mp4', 'v.m4v', 'v.mov', 'v.webm']) {
            expect(routeAssetKind(p)).toBe('media');
        }
    });

    test('routes json to "json"', () => {
        expect(routeAssetKind('config.json')).toBe('json');
    });

    test('falls back to "binary" for unknown extensions', () => {
        expect(routeAssetKind('blob.bin')).toBe('binary');
        expect(routeAssetKind('data.pb')).toBe('binary');
    });

    test('returns undefined when there is no extension', () => {
        expect(routeAssetKind('README')).toBeUndefined();
    });
});

describe('sha256Hex', () => {
    test('returns a 64-char hex sha256', () => {
        const hash = sha256Hex(new Uint8Array([1, 2, 3]));
        expect(hash).toMatch(/^[0-9a-f]{64}$/);
    });

    test('is deterministic for the same bytes', () => {
        const bytes = new Uint8Array([9, 8, 7, 6]);
        expect(sha256Hex(bytes)).toBe(sha256Hex(bytes));
    });
});

describe('extractSvgViewBox', () => {
    test('extracts viewBox attribute when present', () => {
        expect(extractSvgViewBox('<svg viewBox="0 0 24 24"/>')).toBe('0 0 24 24');
    });

    test('extracts viewBox from a multi-attr svg tag', () => {
        expect(
            extractSvgViewBox('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 50" width="100">'),
        ).toBe('0 0 100 50');
    });

    test('accepts single-quoted viewBox', () => {
        expect(extractSvgViewBox("<svg viewBox='0 0 10 10'/>")).toBe('0 0 10 10');
    });

    test('returns undefined when viewBox is absent', () => {
        expect(extractSvgViewBox('<svg width="10"/>')).toBeUndefined();
    });
});

describe('deriveFontFamily', () => {
    test('strips directory and extension', () => {
        expect(deriveFontFamily('assets/fonts/Inter-Bold.ttf')).toBe('Inter-Bold');
    });

    test('handles no directory', () => {
        expect(deriveFontFamily('Inter.woff2')).toBe('Inter');
    });

    test('falls back to "asset" when name is empty after stripping', () => {
        expect(deriveFontFamily('.ttf')).toBe('asset');
    });
});

describe('createOverlayAssetManifestBuilder', () => {
    test('collects descriptors and exposes them as an ABI v1 manifest', () => {
        const builder = createOverlayAssetManifestBuilder();
        const d: AssetDescriptor = {
            kind: 'image',
            hash: 'abc',
            mime: 'image/png',
            uri: 'https://cdn/x.png',
        };
        builder.register('image/abc', d);
        expect(builder.size).toBe(1);
        const manifest = builder.build();
        expect(manifest.abi).toBe('v1');
        expect(manifest.assets['image/abc']).toBe(d);
    });

    test('duplicate register with same content is idempotent (last write wins)', () => {
        const builder = createOverlayAssetManifestBuilder();
        const d1: AssetDescriptor = { kind: 'text', hash: 'h', value: 'hello' };
        const d2: AssetDescriptor = { kind: 'text', hash: 'h', value: 'hello' };
        builder.register('text/h', d1);
        builder.register('text/h', d2);
        expect(builder.size).toBe(1);
        expect(builder.build().assets['text/h']).toBe(d2);
    });
});

describe('createAssetsResolvePlugin — image', () => {
    test('emits a resolveAsset stub + registers an image descriptor with sha256 id', () => {
        const harness = createPluginHarness({
            'assets/icon.png': new Uint8Array([0, 1, 2]),
        });
        const out = harness.load('assets/icon.png');
        expect(out?.contents).toContain('resolveAsset("image/');
        const manifest = harness.manifest.build();
        expect(Object.keys(manifest.assets)).toHaveLength(1);
        const [assetId] = Object.keys(manifest.assets);
        expect(assetId).toMatch(/^image\/[0-9a-f]{64}$/);
        const d = manifest.assets[assetId] as AssetDescriptor;
        expect(d.kind).toBe('image');
        expect(d.hash).toMatch(/^[0-9a-f]{64}$/);
        if (d.kind === 'image') {
            expect(d.mime).toBe('image/png');
            expect(d.uri).toContain('cdn.example.com');
        }
    });

    test('image assetId matches the hash portion of the URL', () => {
        const harness = createPluginHarness({
            'a.png': new Uint8Array([9, 8, 7]),
        });
        harness.load('a.png');
        const manifest = harness.manifest.build();
        const [assetId] = Object.keys(manifest.assets);
        const hash = assetId.split('/')[1];
        const d = manifest.assets[assetId] as Extract<AssetDescriptor, { kind: 'image' }>;
        expect(d.uri).toContain(hash);
    });
});

describe('createAssetsResolvePlugin — font', () => {
    test('registers a font descriptor with family derived from filename', () => {
        const harness = createPluginHarness({
            'fonts/Inter-Bold.ttf': new Uint8Array([0, 0, 0]),
        });
        const out = harness.load('fonts/Inter-Bold.ttf');
        expect(out?.contents).toContain('resolveAsset("font/');
        const manifest = harness.manifest.build();
        const [id] = Object.keys(manifest.assets);
        const d = manifest.assets[id] as Extract<AssetDescriptor, { kind: 'font' }>;
        expect(d.kind).toBe('font');
        expect(d.family).toBe('Inter-Bold');
        expect(d.mime).toBe('font/ttf');
    });
});

describe('createAssetsResolvePlugin — svg', () => {
    test('registers an svg descriptor with viewBox extracted', () => {
        const harness = createPluginHarness({
            'icon.svg': '<svg viewBox="0 0 24 24"><path/></svg>',
        });
        harness.load('icon.svg');
        const manifest = harness.manifest.build();
        const [id] = Object.keys(manifest.assets);
        const d = manifest.assets[id] as Extract<AssetDescriptor, { kind: 'svg' }>;
        expect(d.kind).toBe('svg');
        expect(d.mime).toBe('image/svg+xml');
        expect(d.viewBox).toBe('0 0 24 24');
    });

    test('svg without viewBox registers without the optional field', () => {
        const harness = createPluginHarness({
            'x.svg': '<svg width="10"/>',
        });
        harness.load('x.svg');
        const manifest = harness.manifest.build();
        const d = Object.values(manifest.assets)[0] as Extract<AssetDescriptor, { kind: 'svg' }>;
        expect(d.viewBox).toBeUndefined();
    });
});

describe('createAssetsResolvePlugin — media', () => {
    test('registers a media descriptor for audio', () => {
        const harness = createPluginHarness({
            'sfx.mp3': new Uint8Array([0, 0, 0, 0]),
        });
        harness.load('sfx.mp3');
        const manifest = harness.manifest.build();
        const d = Object.values(manifest.assets)[0] as Extract<AssetDescriptor, { kind: 'media' }>;
        expect(d.kind).toBe('media');
        expect(d.mime).toBe('audio/mpeg');
    });

    test('registers a media descriptor for video', () => {
        const harness = createPluginHarness({
            'clip.mp4': new Uint8Array([0, 0, 0, 0]),
        });
        harness.load('clip.mp4');
        const manifest = harness.manifest.build();
        const d = Object.values(manifest.assets)[0] as Extract<AssetDescriptor, { kind: 'media' }>;
        expect(d.mime).toBe('video/mp4');
    });
});

describe('createAssetsResolvePlugin — json', () => {
    test('registers a json descriptor with parsed value', () => {
        const harness = createPluginHarness({
            'config.json': '{"n":42,"s":"hi"}',
        });
        harness.load('config.json');
        const manifest = harness.manifest.build();
        const d = Object.values(manifest.assets)[0] as Extract<AssetDescriptor, { kind: 'json' }>;
        expect(d.kind).toBe('json');
        expect(d.value).toEqual({ n: 42, s: 'hi' });
    });

    test('malformed JSON returns undefined (esbuild falls through)', () => {
        const harness = createPluginHarness({
            'bad.json': '{oops}',
        });
        const out = harness.load('bad.json');
        expect(out).toBeUndefined();
        expect(harness.manifest.size).toBe(0);
    });
});

describe('createAssetsResolvePlugin — path + file resolution', () => {
    test('returns undefined when asset is not in the virtual file map', () => {
        const harness = createPluginHarness({});
        expect(harness.load('missing.png')).toBeUndefined();
        expect(harness.manifest.size).toBe(0);
    });

    test('normalizes backslashes and leading slash for path lookup', () => {
        const harness = createPluginHarness({
            'assets/icon.png': new Uint8Array([1]),
        });
        expect(harness.load('\\assets\\icon.png')?.contents).toContain('resolveAsset("image/');
        expect(harness.load('/assets/icon.png')?.contents).toContain('resolveAsset("image/');
    });

    test('identical bytes at different paths share the same assetId (content-addressed)', () => {
        const bytes = new Uint8Array([7, 7, 7]);
        const harness = createPluginHarness({
            'a/icon.png': bytes,
            'b/icon.png': bytes,
        });
        harness.load('a/icon.png');
        harness.load('b/icon.png');
        // Same hash + same kind → same assetId → 1 entry in manifest (last write wins).
        expect(harness.manifest.size).toBe(1);
    });
});

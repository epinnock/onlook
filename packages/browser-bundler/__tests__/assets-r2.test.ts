import { describe, expect, test } from 'bun:test';

import {
    createAssetsR2Plugin,
    createImmutableAssetUrl,
    createR2AssetModule,
    defaultAssetKey,
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

    // ─── defaultAssetKey content-addressing (task #64) ──────────────────────
    describe('defaultAssetKey', () => {
        test('returns a 64-char hex sha256', () => {
            const key = defaultAssetKey({
                path: 'assets/icon.png',
                contents: new Uint8Array([1, 2, 3]),
            });
            expect(key).toMatch(/^[0-9a-f]{64}$/);
        });

        test('is deterministic for identical (path, contents) across calls', () => {
            const path = 'assets/icon.png';
            const bytes = new Uint8Array([1, 2, 3, 4, 5]);
            const a = defaultAssetKey({ path, contents: bytes });
            const b = defaultAssetKey({ path, contents: bytes });
            expect(a).toBe(b);
        });

        test('different contents at the same path → different key (cache-invalidation contract)', () => {
            const path = 'assets/icon.png';
            const a = defaultAssetKey({ path, contents: new Uint8Array([1, 2, 3]) });
            const b = defaultAssetKey({ path, contents: new Uint8Array([1, 2, 4]) });
            expect(a).not.toBe(b);
        });

        test('same contents at different paths → different key (path included in digest)', () => {
            // Path is part of the sha256 input (with a null separator), so
            // moving an identical binary under a new name yields a fresh key.
            // Prevents collisions when two source files share bytes but must
            // remain independently cacheable.
            const bytes = new Uint8Array([9, 9, 9]);
            const a = defaultAssetKey({ path: 'icons/a.png', contents: bytes });
            const b = defaultAssetKey({ path: 'icons/b.png', contents: bytes });
            expect(a).not.toBe(b);
        });
    });

    // ─── URL-building invariants (task #64) ─────────────────────────────────
    describe('createImmutableAssetUrl', () => {
        test('injects trailing slash in base URL when missing', () => {
            // Base without `/` at the end should still produce the same
            // `<base>/<key>` shape.
            const url = createImmutableAssetUrl(
                'https://cdn.example.com/assets',
                'abc123',
            );
            expect(url).toBe('https://cdn.example.com/assets/abc123');
        });

        test('preserves a pre-existing trailing slash in base URL', () => {
            const url = createImmutableAssetUrl(
                'https://cdn.example.com/assets/',
                'abc123',
            );
            expect(url).toBe('https://cdn.example.com/assets/abc123');
        });

        test('accepts a URL object as base and yields the same result as a string', () => {
            const fromString = createImmutableAssetUrl('https://cdn.example.com/assets/', 'k');
            const fromURL = createImmutableAssetUrl(new URL('https://cdn.example.com/assets/'), 'k');
            expect(fromString).toBe(fromURL);
        });

        test('handles nested key paths by per-segment encoding', () => {
            const url = createImmutableAssetUrl(
                'https://cdn.example.com/assets/',
                'folder name/sub/image.png',
            );
            // Each segment encoded independently; '/' stays intact as a separator.
            expect(url).toBe(
                'https://cdn.example.com/assets/folder%20name/sub/image.png',
            );
        });
    });

    // ─── R2 module size boundary (task #68) ─────────────────────────────────
    test('exact-threshold bytes are NOT uploaded (plugin prefers inline handoff)', () => {
        // byteLength === maxInlineBytes should return undefined so that
        // assets-inline.ts (which runs with the same threshold check using
        // `>`) picks up the asset and inlines it. This keeps the plugin
        // pair's size-split boundary consistent.
        const result = createR2AssetModule({
            contents: new Uint8Array([1, 2, 3]),
            path: 'assets/x.png',
            baseAssetUrl: 'https://cdn.example.com/assets/',
            maxInlineBytes: 3,
            assetKey: () => 'ignored',
        });
        expect(result).toBeUndefined();
    });
});

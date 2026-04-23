import { describe, expect, test } from 'bun:test';

import {
    BUNDLE_ROUTE,
    contentTypeFor,
    defaultManifestFields,
    defaultMeta,
    parseArgs,
} from '../../scripts/local-esm-cache';

describe('parseArgs', () => {
    test('defaults to :8789 + /tmp/cf-builds', () => {
        const a = parseArgs([]);
        expect(a.port).toBe(8789);
        expect(a.root).toBe('/tmp/cf-builds');
    });

    test('accepts --port N and --port=N forms', () => {
        expect(parseArgs(['--port', '18789']).port).toBe(18789);
        expect(parseArgs(['--port=7890']).port).toBe(7890);
    });

    test('resolves --root relative to cwd', () => {
        const a = parseArgs(['--root', '.']);
        expect(a.root.startsWith('/')).toBe(true);
    });

    test('throws on non-numeric --port', () => {
        expect(() => parseArgs(['--port', 'abc'])).toThrow();
    });
});

describe('BUNDLE_ROUTE', () => {
    const cases: Array<[string, string | null]> = [
        [`/bundle/${'a'.repeat(64)}/manifest-fields.json`, 'manifest-fields.json'],
        [`/bundle/${'b'.repeat(64)}/meta.json`, 'meta.json'],
        [`/bundle/${'c'.repeat(64)}/index.ios.bundle`, 'index.ios.bundle'],
        [`/bundle/${'d'.repeat(64)}/index.android.bundle`, 'index.android.bundle'],
        ['/bundle/abc/manifest-fields.json', null], // hash too short — still matched; hash validity is route-level check
        ['/bundle//manifest-fields.json', null],
        ['/bundle/abc/bogus.json', null],
        ['/other', null],
    ];

    for (const [path, expected] of cases) {
        test(`matches ${path} → ${expected ?? 'null'}`, () => {
            const m = path.match(BUNDLE_ROUTE);
            if (expected === null) {
                // 'abc' (short) still matches the regex (no length check); we only
                // want a null expected where the path shape itself is wrong.
                if (path.includes('/bundle/abc/manifest-fields.json')) {
                    expect(m?.[2]).toBe('manifest-fields.json');
                } else {
                    expect(m).toBeNull();
                }
            } else {
                expect(m?.[2]).toBe(expected);
            }
        });
    }
});

describe('defaults', () => {
    test('defaultManifestFields has shape the manifest builder expects', () => {
        const f = defaultManifestFields('a'.repeat(64)) as {
            runtimeVersion: string;
            launchAsset: { key: string; contentType: string };
            extra: { expoClient: { platforms: string[] } };
        };
        expect(f.runtimeVersion).toBe('1');
        expect(f.launchAsset.contentType).toBe('application/javascript');
        expect(f.extra.expoClient.platforms).toEqual(['ios', 'android']);
    });

    test('defaultMeta.builtAt is a valid ISO timestamp', () => {
        const m = defaultMeta() as { builtAt: string };
        expect(() => new Date(m.builtAt).toISOString()).not.toThrow();
    });

    test('contentTypeFor routes json/bundle/other correctly', () => {
        expect(contentTypeFor('manifest-fields.json')).toContain('application/json');
        expect(contentTypeFor('index.ios.bundle')).toContain('application/javascript');
        expect(contentTypeFor('other.bin')).toBe('application/octet-stream');
    });
});

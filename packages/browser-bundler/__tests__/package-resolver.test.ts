import { describe, expect, test } from 'bun:test';

import { resolvePackageEntry, type PackageJson } from '../src/package-resolver';

describe('resolvePackageEntry — root specifier', () => {
    test('prefers react-native string over module/main', () => {
        const pkg: PackageJson = {
            main: 'dist/cjs/index.js',
            module: 'dist/esm/index.js',
            'react-native': 'dist/rn/index.js',
        };
        expect(resolvePackageEntry({ pkg })).toBe('dist/rn/index.js');
    });

    test('prefers exports string over module/main when react-native absent', () => {
        const pkg: PackageJson = {
            main: 'dist/cjs/index.js',
            module: 'dist/esm/index.js',
            exports: './dist/exports/index.js',
        };
        expect(resolvePackageEntry({ pkg })).toBe('dist/exports/index.js');
    });

    test('prefers module over main when neither react-native nor exports present', () => {
        const pkg: PackageJson = {
            main: 'dist/cjs/index.js',
            module: 'dist/esm/index.js',
        };
        expect(resolvePackageEntry({ pkg })).toBe('dist/esm/index.js');
    });

    test('falls through to main when no other field present', () => {
        const pkg: PackageJson = { main: 'dist/cjs/index.js' };
        expect(resolvePackageEntry({ pkg })).toBe('dist/cjs/index.js');
    });

    test('returns null when no applicable field', () => {
        expect(resolvePackageEntry({ pkg: { name: 'foo' } })).toBeNull();
    });

    test('strips leading ./ from the resolved path', () => {
        const pkg: PackageJson = { main: './src/index.js' };
        expect(resolvePackageEntry({ pkg })).toBe('src/index.js');
    });
});

describe('resolvePackageEntry — subpath specifier', () => {
    test('resolves react-native subpath map', () => {
        const pkg: PackageJson = {
            'react-native': {
                './fp': './dist/rn/fp.js',
            },
        };
        expect(resolvePackageEntry({ pkg, subpath: 'fp' })).toBe('dist/rn/fp.js');
    });

    test('resolves exports subpath entry with object-form priority', () => {
        const pkg: PackageJson = {
            exports: {
                './fp': {
                    'react-native': './rn/fp.js',
                    import: './esm/fp.js',
                    default: './cjs/fp.js',
                },
            },
        };
        expect(resolvePackageEntry({ pkg, subpath: 'fp' })).toBe('rn/fp.js');
    });

    test('subpath falls back to import when react-native absent', () => {
        const pkg: PackageJson = {
            exports: {
                './fp': {
                    import: './esm/fp.js',
                    default: './cjs/fp.js',
                },
            },
        };
        expect(resolvePackageEntry({ pkg, subpath: 'fp' })).toBe('esm/fp.js');
    });

    test('returns null for a subpath that has no entry', () => {
        const pkg: PackageJson = {
            exports: { '.': './src/index.js' },
        };
        expect(resolvePackageEntry({ pkg, subpath: 'missing' })).toBeNull();
    });
});

describe('resolvePackageEntry — priority semantics', () => {
    test('react-native map takes precedence over exports map', () => {
        const pkg: PackageJson = {
            'react-native': { './fp': './rn/fp.js' },
            exports: {
                './fp': { default: './cjs/fp.js' },
            },
        };
        expect(resolvePackageEntry({ pkg, subpath: 'fp' })).toBe('rn/fp.js');
    });

    test('browser field is NOT consulted', () => {
        const pkg: PackageJson = {
            main: './main.js',
            browser: './browser.js',
        };
        expect(resolvePackageEntry({ pkg })).toBe('main.js');
    });
});

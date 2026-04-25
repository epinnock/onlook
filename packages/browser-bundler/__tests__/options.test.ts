import { describe, expect, test } from 'bun:test';

import {
    createBrowserBundleOptions,
    normalizeVirtualPath,
} from '../src/options';

describe('browser bundle options', () => {
    test('normalizes defaults and virtual paths', () => {
        const options = createBrowserBundleOptions({
            entryPoint: 'src\\App.tsx',
            files: [{ path: 'src\\App.tsx', contents: 'export default null;' }],
            externalSpecifiers: ['react'],
        });

        expect(options.entryPoint).toBe('src/App.tsx');
        expect(options.files[0]?.path).toBe('src/App.tsx');
        expect(options.platform).toBe('ios');
        expect(options.minify).toBe(false);
        expect(options.sourcemap).toBe(true);
        expect(options.externalSpecifiers.has('react')).toBe(true);
    });

    test('preserves explicit transform options', () => {
        const wasmUrl = new URL('https://cdn.example.com/esbuild.wasm');
        const options = createBrowserBundleOptions({
            entryPoint: '/App.tsx',
            files: [{ path: '/App.tsx', contents: 'export default null;' }],
            externalSpecifiers: ['react'],
            platform: 'android',
            minify: true,
            sourcemap: false,
            wasmUrl,
        });

        expect(options.platform).toBe('android');
        expect(options.minify).toBe(true);
        expect(options.sourcemap).toBe(false);
        expect(options.wasmUrl).toBe(wasmUrl);
    });

    test('validates required inputs', () => {
        expect(() =>
            createBrowserBundleOptions({
                entryPoint: '',
                files: [{ path: '/App.tsx', contents: '' }],
                externalSpecifiers: ['react'],
            }),
        ).toThrow('entryPoint');

        expect(() =>
            createBrowserBundleOptions({
                entryPoint: '/App.tsx',
                files: [],
                externalSpecifiers: ['react'],
            }),
        ).toThrow('at least one virtual file');
    });

    test('normalizes virtual paths', () => {
        expect(normalizeVirtualPath('\\src\\App.tsx')).toBe('/src/App.tsx');
    });
});

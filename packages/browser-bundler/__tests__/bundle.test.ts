import { describe, expect, test } from 'bun:test';

import {
    bundleBrowserProject,
    type BrowserBundlerBuildOptions,
    type BrowserBundlerEsbuildService,
} from '../src/bundle';

describe('bundleBrowserProject', () => {
    test('passes normalized options and plugins to esbuild', async () => {
        let captured: BrowserBundlerBuildOptions | undefined;
        const service: BrowserBundlerEsbuildService = {
            async build(options) {
                captured = options;
                return {
                    outputFiles: [
                        { path: 'out.js', text: 'module.exports = {};' },
                        { path: 'out.js.map', text: '{}' },
                    ],
                    warnings: [{ text: 'ok' }],
                };
            },
        };

        const result = await bundleBrowserProject(
            {
                entryPoint: 'src\\App.tsx',
                files: [{ path: 'src\\App.tsx', contents: 'export default null;' }],
                externalSpecifiers: ['react'],
                minify: true,
            },
            service,
        );

        expect(captured?.entryPoints).toEqual(['src/App.tsx']);
        expect(captured?.bundle).toBe(true);
        expect(captured?.format).toBe('cjs');
        expect(captured?.platform).toBe('browser');
        expect(captured?.write).toBe(false);
        expect(captured?.minify).toBe(true);
        expect(captured?.plugins.map((plugin) => plugin.name)).toEqual([
            'onlook-external-base-bundle-imports',
            'virtual-fs-resolve',
            'virtual-fs-load',
        ]);
        expect(result).toEqual({
            code: 'module.exports = {};',
            sourceMap: '{}',
            warnings: [{ text: 'ok' }],
        });
    });

    test('injectJsxSource: true wires onlook-jsx-source plugin BEFORE virtual-fs-load', async () => {
        // Plugin order matters in esbuild — first plugin to claim an
        // .tsx/.jsx file in onLoad wins. jsx-source must precede
        // virtual-fs-load so the __source-injected contents reach esbuild
        // rather than the raw source.
        let captured: BrowserBundlerBuildOptions | undefined;
        const service: BrowserBundlerEsbuildService = {
            async build(options) {
                captured = options;
                return {
                    outputFiles: [{ path: 'out.js', text: 'module.exports = {};' }],
                };
            },
        };

        await bundleBrowserProject(
            {
                entryPoint: '/App.tsx',
                files: [{ path: '/App.tsx', contents: 'export default null;' }],
                externalSpecifiers: ['react'],
                injectJsxSource: true,
            },
            service,
        );

        expect(captured?.plugins.map((plugin) => plugin.name)).toEqual([
            'onlook-external-base-bundle-imports',
            'virtual-fs-resolve',
            'onlook-jsx-source',
            'virtual-fs-load',
        ]);
    });

    test('injectJsxSource defaults to false (omits the jsx-source plugin)', async () => {
        // Backwards-compatible default. The browser-metro path uses sucrase
        // for jsx-source injection, not this plugin — so the bundler stays
        // off-by-default and only the v1 overlay path opts in.
        let captured: BrowserBundlerBuildOptions | undefined;
        const service: BrowserBundlerEsbuildService = {
            async build(options) {
                captured = options;
                return {
                    outputFiles: [{ path: 'out.js', text: 'module.exports = {};' }],
                };
            },
        };

        await bundleBrowserProject(
            {
                entryPoint: '/App.tsx',
                files: [{ path: '/App.tsx', contents: 'export default null;' }],
                externalSpecifiers: ['react'],
                // No injectJsxSource passed → default false.
            },
            service,
        );

        expect(captured?.plugins.map((plugin) => plugin.name)).not.toContain(
            'onlook-jsx-source',
        );
    });

    test('rejects empty output', async () => {
        await expect(
            bundleBrowserProject(
                {
                    entryPoint: '/App.tsx',
                    files: [{ path: '/App.tsx', contents: 'export default null;' }],
                    externalSpecifiers: ['react'],
                },
                {
                    async build() {
                        return { outputFiles: [{ path: 'out.js', text: ' ' }] };
                    },
                },
            ),
        ).rejects.toThrow('no JavaScript output');
    });
});

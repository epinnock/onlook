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

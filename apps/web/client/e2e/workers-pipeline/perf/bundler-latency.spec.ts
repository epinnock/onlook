/**
 * workers-pipeline perf — bundler cold vs warm vs edit latency.
 *
 * Measures three scenarios against the hello + tabs-template fixtures:
 *   (a) cold: fresh IncrementalBundler, first build.
 *   (b) warm: second build with unchanged inputs — expect cache hit.
 *   (c) edit: third build after a single-file edit — expect fresh rebuild.
 *
 * Targets are loose upper bounds for local machines, chosen so the CI
 * signal catches "something got 10× slower" without thrashing on normal
 * variance. Adjust if the fleet ever fails on a non-regression.
 */
import { expect, test } from '@playwright/test';

import {
    createIncrementalBundler,
} from '../../../../../../packages/browser-bundler/src';
import {
    bundleFixtureAsOverlay,
    loadFixtureForBundling,
} from '../helpers/browser-bundler-harness';

const HELLO_COLD_MS = 400; // real esbuild usually lands in ~40–80ms; wide safety margin.
const TABS_COLD_MS = 600;
const WARM_HIT_MS = 10; // cache hit must be essentially free.

test.describe('workers-pipeline perf — bundler latency', () => {
    test('hello cold bundle stays under the target', async () => {
        const { durationMs } = await bundleFixtureAsOverlay('hello');
        expect(durationMs).toBeLessThan(HELLO_COLD_MS);
    });

    test('tabs-template cold bundle stays under the target', async () => {
        const { durationMs } = await bundleFixtureAsOverlay('tabs-template');
        expect(durationMs).toBeLessThan(TABS_COLD_MS);
    });

    test('warm rebuild with unchanged inputs is a cache hit and near-zero', async () => {
        const fixture = loadFixtureForBundling('hello');
        const esbuild = await import('esbuild');
        const service = {
            async build(options: Parameters<typeof esbuild.build>[0]) {
                const result = await esbuild.build({ ...options, outfile: '/out/overlay.js' });
                return {
                    outputFiles: result.outputFiles?.map((f) => ({ path: f.path, text: f.text })),
                    warnings: result.warnings,
                };
            },
        };

        const entryResolver = {
            name: 'harness-virtual-entry',
            setup(build: {
                onResolve: (
                    opts: { filter: RegExp },
                    cb: (args: { path: string }) => { path: string } | undefined,
                ) => void;
            }) {
                const virtualPaths = new Set(fixture.files.map((f) => f.path));
                build.onResolve({ filter: /^\/[^/]/ }, (args) => {
                    if (virtualPaths.has(args.path)) return { path: args.path };
                    return undefined;
                });
            },
        };

        // Wrap the service so the entry resolver is always threaded through.
        const wrapped = {
            async build(options: Parameters<typeof service.build>[0]) {
                return service.build({
                    ...options,
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    plugins: [entryResolver, ...(options.plugins as readonly any[])],
                });
            },
        };

        const inc = createIncrementalBundler();
        const input = {
            entryPoint: fixture.entryPoint,
            files: fixture.files,
            externalSpecifiers: ['react', 'react-native'],
            sourcemap: true,
            minify: false,
        };

        await inc.build(input, wrapped);
        const t0 = performance.now();
        const warm = await inc.build(input, wrapped);
        const warmMs = performance.now() - t0;

        expect(warm.cached).toBe(true);
        expect(warmMs).toBeLessThan(WARM_HIT_MS);
        expect(inc.rebuilds).toBe(1);
        expect(inc.hits).toBe(1);
    });

    test('edit invalidates the cache and triggers a fresh (under-target) rebuild', async () => {
        const fixture = loadFixtureForBundling('hello');
        const esbuild = await import('esbuild');
        const baseService = {
            async build(options: Parameters<typeof esbuild.build>[0]) {
                const result = await esbuild.build({ ...options, outfile: '/out/overlay.js' });
                return {
                    outputFiles: result.outputFiles?.map((f) => ({ path: f.path, text: f.text })),
                    warnings: result.warnings,
                };
            },
        };
        const entryResolver = {
            name: 'harness-virtual-entry',
            setup(build: {
                onResolve: (
                    opts: { filter: RegExp },
                    cb: (args: { path: string }) => { path: string } | undefined,
                ) => void;
            }) {
                const virtualPaths = new Set(fixture.files.map((f) => f.path));
                build.onResolve({ filter: /^\/[^/]/ }, (args) => {
                    if (virtualPaths.has(args.path)) return { path: args.path };
                    return undefined;
                });
            },
        };
        const wrapped = {
            async build(options: Parameters<typeof baseService.build>[0]) {
                return baseService.build({
                    ...options,
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    plugins: [entryResolver, ...(options.plugins as readonly any[])],
                });
            },
        };

        const inc = createIncrementalBundler();
        const input = {
            entryPoint: fixture.entryPoint,
            files: fixture.files,
            externalSpecifiers: ['react', 'react-native'],
            sourcemap: true,
            minify: false,
        };

        await inc.build(input, wrapped);
        const edited = {
            ...input,
            files: fixture.files.map((f) =>
                f.path === fixture.entryPoint
                    ? { ...f, contents: `${f.contents}\n// edited` }
                    : f,
            ),
        };

        const t0 = performance.now();
        const after = await inc.build(edited, wrapped);
        const editMs = performance.now() - t0;

        expect(after.cached).toBe(false);
        expect(editMs).toBeLessThan(HELLO_COLD_MS);
    });
});

import { describe, expect, test } from 'bun:test';

import { createEsbuildLoader } from '../src/esbuild-loader';

describe('esbuild loader', () => {
    test('initializes only once for sequential callers', async () => {
        const paths: string[] = [];

        const loader = createEsbuildLoader({
            path: '/assets/esbuild.wasm',
            initialize: async ({ wasmPath }) => {
                paths.push(wasmPath);
                return { wasmPath };
            },
        });

        const first = await loader.load();
        const second = await loader.load();

        expect(paths).toEqual(['/assets/esbuild.wasm']);
        expect(first).toBe(second);
    });

    test('shares one initialization across concurrent callers', async () => {
        let initCount = 0;
        let release: () => void = () => {};

        const ready = new Promise<void>((resolve) => {
            release = resolve;
        });

        const loader = createEsbuildLoader({
            path: '/assets/esbuild.wasm',
            initialize: async () => {
                initCount += 1;
                await ready;
                return { initCount };
            },
        });

        const firstLoad = loader.load();
        const secondLoad = loader.load();

        expect(firstLoad).toBe(secondLoad);

        await Promise.resolve();

        expect(initCount).toBe(1);

        release();

        await expect(firstLoad).resolves.toEqual({ initCount: 1 });
        await expect(secondLoad).resolves.toEqual({ initCount: 1 });
    });

    test('forwards an explicit wasm URL to the initializer', async () => {
        const paths: string[] = [];

        const loader = createEsbuildLoader({
            path: new URL('./esbuild.wasm', 'https://example.com/app/'),
            initialize: async ({ wasmPath }) => {
                paths.push(wasmPath);
                return wasmPath;
            },
        });

        await expect(loader.load()).resolves.toBe('https://example.com/app/esbuild.wasm');
        expect(paths).toEqual(['https://example.com/app/esbuild.wasm']);
    });

    test('retries after a failed initialization', async () => {
        let attempts = 0;

        const loader = createEsbuildLoader({
            path: '/assets/esbuild.wasm',
            initialize: async () => {
                attempts += 1;

                if (attempts === 1) {
                    throw new Error('boom');
                }

                return { attempts };
            },
        });

        await expect(loader.load()).rejects.toThrow('boom');
        await expect(loader.load()).resolves.toEqual({ attempts: 2 });
        expect(attempts).toBe(2);
    });
});

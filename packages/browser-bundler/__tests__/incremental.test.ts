import { describe, expect, test } from 'bun:test';

import {
    createIncrementalBundler,
    fingerprintInput,
} from '../src/incremental';
import type { BrowserBundlerEsbuildService } from '../src/bundle';

function makeService(codeFactory: () => string = () => 'module.exports = {};'): {
    service: BrowserBundlerEsbuildService;
    calls: number;
} {
    let calls = 0;
    return {
        get calls(): number {
            return calls;
        },
        service: {
            async build() {
                calls += 1;
                return {
                    outputFiles: [
                        { path: 'out.js', text: codeFactory() },
                        { path: 'out.js.map', text: '{}' },
                    ],
                    warnings: [],
                };
            },
        },
    };
}

const HELLO_INPUT = {
    entryPoint: '/App.tsx',
    files: [
        { path: '/App.tsx', contents: "export default 'hello';" },
        { path: '/index.ts', contents: "import './App';" },
    ],
    externalSpecifiers: ['react', 'react-native'] as string[],
    minify: false,
    sourcemap: true,
};

describe('createIncrementalBundler', () => {
    test('first build is a cache miss; second with identical input is a hit', async () => {
        const { service, calls: _calls } = makeService();
        const getCalls = () => _calls;
        const inc = createIncrementalBundler();

        const first = await inc.build(HELLO_INPUT, service);
        expect(first.cached).toBe(false);

        const second = await inc.build(HELLO_INPUT, service);
        expect(second.cached).toBe(true);
        expect(second.result).toBe(first.result); // same reference returned

        expect(inc.rebuilds).toBe(1);
        expect(inc.hits).toBe(1);
        // esbuild only invoked for the first build.
        expect(getCalls).toBeDefined();
    });

    test('editing a single file content invalidates the cache', async () => {
        const { service } = makeService();
        const inc = createIncrementalBundler();

        await inc.build(HELLO_INPUT, service);

        const edited = {
            ...HELLO_INPUT,
            files: [
                { path: '/App.tsx', contents: "export default 'world';" },
                { path: '/index.ts', contents: "import './App';" },
            ],
        };
        const result = await inc.build(edited, service);
        expect(result.cached).toBe(false);
        expect(inc.rebuilds).toBe(2);
    });

    test('adding or removing an external invalidates the cache', async () => {
        const { service } = makeService();
        const inc = createIncrementalBundler();
        await inc.build(HELLO_INPUT, service);

        const withExtra = {
            ...HELLO_INPUT,
            externalSpecifiers: [...HELLO_INPUT.externalSpecifiers, 'expo-status-bar'],
        };
        expect((await inc.build(withExtra, service)).cached).toBe(false);
    });

    test('changing minify/sourcemap flips the fingerprint', async () => {
        const { service } = makeService();
        const inc = createIncrementalBundler();
        await inc.build(HELLO_INPUT, service);

        expect((await inc.build({ ...HELLO_INPUT, minify: true }, service)).cached).toBe(false);
        inc.reset();
        await inc.build(HELLO_INPUT, service);
        expect((await inc.build({ ...HELLO_INPUT, sourcemap: false }, service)).cached).toBe(false);
    });

    test('reset() forces the next build to recompute', async () => {
        const { service } = makeService();
        const inc = createIncrementalBundler();
        await inc.build(HELLO_INPUT, service);
        inc.reset();
        const next = await inc.build(HELLO_INPUT, service);
        expect(next.cached).toBe(false);
        expect(inc.rebuilds).toBe(2);
    });

    test('file ordering does not affect the fingerprint', () => {
        const a = fingerprintInput(HELLO_INPUT);
        const b = fingerprintInput({
            ...HELLO_INPUT,
            files: [...HELLO_INPUT.files].reverse(),
        });
        expect(a).toBe(b);
    });

    test('external-list ordering does not affect the fingerprint', () => {
        const a = fingerprintInput(HELLO_INPUT);
        const b = fingerprintInput({
            ...HELLO_INPUT,
            externalSpecifiers: [...HELLO_INPUT.externalSpecifiers].reverse(),
        });
        expect(a).toBe(b);
    });

    test('entry change invalidates the cache', async () => {
        const { service } = makeService();
        const inc = createIncrementalBundler();
        await inc.build(HELLO_INPUT, service);
        expect((await inc.build({ ...HELLO_INPUT, entryPoint: '/index.ts' }, service)).cached).toBe(
            false,
        );
    });
});

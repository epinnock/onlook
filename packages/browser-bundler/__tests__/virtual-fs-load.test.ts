import { describe, expect, test } from 'bun:test';

import {
    createVirtualFsLoadPlugin,
    inferVirtualFsLoader,
    loadVirtualFsFile,
    type VirtualFsLoadArgs,
    type VirtualFsLoadBuild,
    type VirtualFsLoadResult,
} from '../src/plugins/virtual-fs-load';

function createPluginHarness(files: Record<string, string>) {
    let callback:
        | ((args: VirtualFsLoadArgs) => VirtualFsLoadResult | Promise<VirtualFsLoadResult>)
        | undefined;
    let filter: RegExp | undefined;
    let namespace: string | undefined;

    const build: VirtualFsLoadBuild = {
        onLoad(options, handler) {
            filter = options.filter;
            namespace = options.namespace;
            callback = handler;
        },
    };

    createVirtualFsLoadPlugin({ files }).setup(build);

    if (callback === undefined || filter === undefined) {
        throw new Error('plugin did not register an onLoad handler');
    }

    return {
        filter,
        namespace,
        load(path: string) {
            return callback?.({ path });
        },
    };
}

describe('virtual fs load', () => {
    test('loads TSX source with the tsx loader', () => {
        const harness = createPluginHarness({
            'src/App.tsx': 'export const App = () => <div>Hello</div>;',
        });

        expect(harness.filter.test('src/App.tsx')).toBe(true);
        expect(harness.load('src/App.tsx')).toEqual({
            contents: 'export const App = () => <div>Hello</div>;',
            loader: 'tsx',
        });
    });

    test('loads JSON source with the json loader', () => {
        const result = loadVirtualFsFile('src/data.json', {
            'src/data.json': '{"answer":42}',
        });

        expect(result).toEqual({
            contents: '{"answer":42}',
            loader: 'json',
        });
    });

    test('throws a clear error for missing files', () => {
        expect(() =>
            loadVirtualFsFile('src/missing.ts', {
                'src/App.tsx': 'export const App = true;',
            }),
        ).toThrow('Unable to load virtual file "src/missing.ts"');
    });

    test('infers code and asset loaders from file extensions', () => {
        expect(inferVirtualFsLoader('src/App.ts')).toBe('ts');
        expect(inferVirtualFsLoader('src/App.tsx')).toBe('tsx');
        expect(inferVirtualFsLoader('src/Button.jsx')).toBe('jsx');
        expect(inferVirtualFsLoader('src/data.json')).toBe('json');
        expect(inferVirtualFsLoader('src/logo.png')).toBe('js');
    });
});

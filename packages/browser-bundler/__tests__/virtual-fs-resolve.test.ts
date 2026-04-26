import { describe, expect, test } from 'bun:test';

import {
    createVirtualFsResolvePlugin,
    resolveVirtualFsImport,
    type VirtualFsResolveArgs,
    type VirtualFsResolveBuild,
    type VirtualFsResolveResult,
} from '../src/plugins/virtual-fs-resolve';

function createPluginHarness(files: Record<string, string>) {
    let callback:
        | ((
              args: VirtualFsResolveArgs,
          ) => VirtualFsResolveResult | Promise<VirtualFsResolveResult> | undefined | void)
        | undefined;
    let filter: RegExp | undefined;

    const build: VirtualFsResolveBuild = {
        onResolve(options, handler) {
            filter = options.filter;
            callback = handler;
        },
    };

    createVirtualFsResolvePlugin({ files }).setup(build);

    if (callback === undefined || filter === undefined) {
        throw new Error('plugin did not register an onResolve handler');
    }

    return {
        filter,
        resolve(path: string, importer: string) {
            return callback?.({ path, importer });
        },
    };
}

describe('virtual fs resolve', () => {
    test('resolves an exact file match', () => {
        expect(
            resolveVirtualFsImport('./App.tsx', 'src/entry.ts', {
                'src/App.tsx': 'export const App = true;',
            }),
        ).toBe('src/App.tsx');
    });

    test('probes supported extensions when the import omits one', () => {
        expect(
            resolveVirtualFsImport('./App', 'src/entry.ts', {
                'src/App.tsx': 'export const App = true;',
            }),
        ).toBe('src/App.tsx');
    });

    test('probes index files for directory imports', () => {
        expect(
            resolveVirtualFsImport('./pages', 'src/entry.ts', {
                'src/pages/index.tsx': 'export const Page = true;',
            }),
        ).toBe('src/pages/index.tsx');
    });

    test('throws a clear error for missing local imports', () => {
        expect(() =>
            resolveVirtualFsImport('./missing', 'src/App.tsx', {
                'src/App.tsx': 'export const App = true;',
            }),
        ).toThrow('Unable to resolve virtual import "./missing" from "src/App.tsx"');
    });

    test('leaves bare imports to other plugins', () => {
        const harness = createPluginHarness({
            'src/App.tsx': 'export const App = true;',
        });

        expect(harness.filter.test('./App')).toBe(true);
        expect(harness.filter.test('react')).toBe(false);
        expect(harness.resolve('react', 'src/App.tsx')).toBeUndefined();
    });
});

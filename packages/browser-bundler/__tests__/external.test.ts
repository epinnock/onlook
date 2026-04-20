import { describe, expect, test } from 'bun:test';

import {
    classifyImportPath,
    createExternalPlugin,
    createExternalSpecifierSet,
    type EsbuildResolveResult,
} from '../src/plugins/external';

describe('external import plugin', () => {
    test('classifies local imports separately from bare imports', () => {
        const specifiers = createExternalSpecifierSet(['react']);

        expect(classifyImportPath('./App', specifiers)).toBe('local');
        expect(classifyImportPath('../theme', specifiers)).toBe('local');
        expect(classifyImportPath('/absolute/App', specifiers)).toBe('local');
    });

    test('externalizes curated bare specifiers', () => {
        const specifiers = createExternalSpecifierSet(['react', 'react-native']);

        expect(classifyImportPath('react', specifiers)).toBe('external');
        expect(classifyImportPath('react-native', specifiers)).toBe('external');
    });

    test('rejects unsupported bare imports', () => {
        const specifiers = createExternalSpecifierSet(['react']);

        expect(classifyImportPath('lodash', specifiers)).toBe('unsupported-bare');
    });

    test('returns esbuild-compatible resolve results', () => {
        const plugin = createExternalPlugin({ externalSpecifiers: ['react'] });
        let resolve: ((args: { path: string }) => EsbuildResolveResult | undefined) | undefined;

        plugin.setup({
            onResolve(_options, callback) {
                resolve = callback;
            },
        });

        expect(resolve?.({ path: './App' })).toBeUndefined();
        expect(resolve?.({ path: 'react' })).toEqual({
            path: 'react',
            external: true,
        });
        expect(resolve?.({ path: 'lodash' })?.errors?.[0]?.text).toContain(
            'Unsupported bare import "lodash"',
        );
    });

    test('rejects empty external specifiers', () => {
        expect(() => createExternalSpecifierSet(['react', ' '])).toThrow(
            'External specifier',
        );
    });
});

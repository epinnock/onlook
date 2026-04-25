import { describe, expect, test } from 'bun:test';
import { createAliasMap } from '../src/adapter/alias-map';
import { createAdapterOverlayMount } from '../src/adapter/mount';

describe('adapter overlay mount', () => {
    test('resolves a bare import through the alias map and metro require callback', () => {
        const aliasMap = createAliasMap({
            react: 7,
        });
        const metroRequire = (moduleId: number) => {
            expect(moduleId).toBe(7);
            return { createElement: 'react-element' };
        };

        const mount = createAdapterOverlayMount({ aliasMap, metroRequire });
        const result = mount(`const React = require('react'); module.exports = React.createElement;`);

        expect(result).toBe('react-element');
    });

    test('returns module.exports after executing commonjs source', () => {
        const aliasMap = createAliasMap({});
        const mount = createAdapterOverlayMount({
            aliasMap,
            metroRequire: () => {
                throw new Error('metroRequire should not be called');
            },
        });

        const result = mount(`module.exports = { ok: true };`);

        expect(result).toEqual({ ok: true });
    });

    test('throws a clear error for unknown bare imports', () => {
        const aliasMap = createAliasMap({
            react: 7,
        });
        const mount = createAdapterOverlayMount({
            aliasMap,
            metroRequire: () => {
                throw new Error('metroRequire should not be called');
            },
        });

        expect(() => mount(`require('expo-status-bar');`)).toThrow(
            'Alias map does not contain an entry for "expo-status-bar". Known specifiers: react',
        );
    });

    test('throws a not-yet-implemented error for relative imports', () => {
        const aliasMap = createAliasMap({});
        const mount = createAdapterOverlayMount({
            aliasMap,
            metroRequire: () => {
                throw new Error('metroRequire should not be called');
            },
        });

        expect(() => mount(`require('./local');`)).toThrow(
            'Adapter overlay evaluator does not yet support relative module specifiers: "./local"',
        );
    });
});

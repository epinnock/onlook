import { describe, expect, test } from 'bun:test';
import {
    createAliasMap,
    getAliasMapModuleId,
    hasAliasMapSpecifier,
    listAliasMapSpecifiers,
} from '../src/adapter/alias-map';

describe('alias-map', () => {
    test('creates a typed alias map from entries', () => {
        const aliasMap = createAliasMap([
            { specifier: 'react', moduleId: 1 },
            { specifier: 'react-native', moduleId: 42 },
        ]);

        expect(listAliasMapSpecifiers(aliasMap)).toEqual(['react', 'react-native']);
        expect(aliasMap.entries).toEqual([
            { specifier: 'react', moduleId: 1 },
            { specifier: 'react-native', moduleId: 42 },
        ]);
        expect(hasAliasMapSpecifier(aliasMap, 'react')).toBe(true);
        expect(getAliasMapModuleId(aliasMap, 'react-native')).toBe(42);
    });

    test('accepts a record input for bare-specifier aliases', () => {
        const aliasMap = createAliasMap({
            react: 1,
            'react-native': 42,
        });

        expect(listAliasMapSpecifiers(aliasMap)).toEqual(['react', 'react-native']);
        expect(getAliasMapModuleId(aliasMap, 'react')).toBe(1);
    });

    test('rejects empty specifiers and non-integer module ids', () => {
        expect(() => createAliasMap([{ specifier: '   ', moduleId: 1 }])).toThrow(
            'Alias map specifier must be a non-empty string',
        );
        expect(() => createAliasMap([{ specifier: 'react', moduleId: 1.5 }])).toThrow(
            'Alias map entry for "react" must use an integer module id',
        );
    });

    test('throws a clear error for unknown imports', () => {
        const aliasMap = createAliasMap([{ specifier: 'react', moduleId: 1 }]);

        expect(() => getAliasMapModuleId(aliasMap, 'expo-status-bar')).toThrow(
            'Alias map does not contain an entry for "expo-status-bar". Known specifiers: react',
        );
    });
});

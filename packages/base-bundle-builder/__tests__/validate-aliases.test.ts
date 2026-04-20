import { describe, expect, test } from 'bun:test';
import { createAliasMap } from '../src/adapter/alias-map';
import {
    assertAliasMapCompleteness,
    validateAliasMapCompleteness,
} from '../src/validate-aliases';

describe('validate-aliases', () => {
    test('reports a complete alias map with no missing or extra specifiers', () => {
        const aliasMap = createAliasMap({
            react: 1,
            'react/jsx-runtime': 2,
            'react-native': 3,
            'react-native-safe-area-context': 4,
            'expo-status-bar': 5,
        });

        expect(validateAliasMapCompleteness(aliasMap)).toEqual({
            isComplete: true,
            missingSpecifiers: [],
            extraSpecifiers: [],
        });
        expect(() => assertAliasMapCompleteness(aliasMap)).not.toThrow();
    });

    test('reports missing curated specifiers and throws a clear error', () => {
        const aliasMap = createAliasMap({
            react: 1,
            'react-native': 2,
            'react-native-safe-area-context': 3,
        });

        expect(validateAliasMapCompleteness(aliasMap)).toEqual({
            isComplete: false,
            missingSpecifiers: ['react/jsx-runtime', 'expo-status-bar'],
            extraSpecifiers: [],
        });
        expect(() => assertAliasMapCompleteness(aliasMap)).toThrow(
            'Alias map is missing curated base-bundle specifiers: "react/jsx-runtime", "expo-status-bar". Known aliases: react, react-native, react-native-safe-area-context',
        );
    });

    test('reports extra aliases without treating them as missing', () => {
        const aliasMap = createAliasMap({
            react: 1,
            'react/jsx-runtime': 2,
            'react-native': 3,
            'react-native-safe-area-context': 4,
            'expo-status-bar': 5,
            lodash: 6,
        });

        expect(validateAliasMapCompleteness(aliasMap)).toEqual({
            isComplete: true,
            missingSpecifiers: [],
            extraSpecifiers: ['lodash'],
        });
        expect(() => assertAliasMapCompleteness(aliasMap)).not.toThrow();
    });
});

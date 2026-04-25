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
            missingRequiredAliases: [],
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
            missingRequiredAliases: ['react/jsx-runtime'],
        });
        // react/jsx-runtime is BOTH curated AND required, so the required-alias
        // path triggers first (task #11 enforcement is stricter).
        expect(() => assertAliasMapCompleteness(aliasMap)).toThrow(
            /REQUIRED_ALIASES.*"react\/jsx-runtime"/,
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
            missingRequiredAliases: [],
        });
        expect(() => assertAliasMapCompleteness(aliasMap)).not.toThrow();
    });

    // ── task #11: REQUIRED_ALIASES enforcement ─────────────────────────────

    test('flags missing REQUIRED_ALIASES distinctly from missing curated specifiers', () => {
        const aliasMap = createAliasMap({ react: 1, 'react/jsx-runtime': 2 });
        const result = validateAliasMapCompleteness(aliasMap);
        expect(result.missingRequiredAliases).toContain('react-native');
        expect(result.missingRequiredAliases).toContain('react-native-safe-area-context');
    });

    test('assertAliasMapCompleteness throws REQUIRED_ALIASES error before curated error', () => {
        const aliasMap = createAliasMap({ react: 1 });
        expect(() => assertAliasMapCompleteness(aliasMap)).toThrow(/REQUIRED_ALIASES.*ABI v1/);
    });
});

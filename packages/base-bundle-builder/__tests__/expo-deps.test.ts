import { describe, expect, test } from 'bun:test';
import {
    isCuratedExpoBundleDependencySpecifier,
    listCuratedBaseBundleDependenciesWithExpo,
    listCuratedBaseBundleDependencySpecifiersWithExpo,
    listCuratedExpoBundleDependencies,
    listCuratedExpoBundleDependencySpecifiers,
} from '../src/expo-deps';

describe('expo dependency curation', () => {
    test('groups Expo specifiers for the base bundle extension', () => {
        expect(listCuratedExpoBundleDependencySpecifiers()).toEqual([
            'expo',
            'expo-constants',
            'expo-modules-core',
            'expo-router',
            'expo-status-bar',
            'react-native-safe-area-context',
        ]);

        expect(listCuratedExpoBundleDependencies()).toEqual([
            { specifier: 'expo', packageName: 'expo' },
            { specifier: 'expo-constants', packageName: 'expo-constants' },
            { specifier: 'expo-modules-core', packageName: 'expo-modules-core' },
            { specifier: 'expo-router', packageName: 'expo-router' },
            { specifier: 'expo-status-bar', packageName: 'expo-status-bar' },
            {
                specifier: 'react-native-safe-area-context',
                packageName: 'react-native-safe-area-context',
            },
        ]);
    });

    test('merges the core curated deps with Expo deps without duplicates', () => {
        expect(listCuratedBaseBundleDependencySpecifiersWithExpo()).toEqual([
            'react',
            'react/jsx-runtime',
            'react-native',
            'react-native-safe-area-context',
            'expo-status-bar',
            'expo',
            'expo-constants',
            'expo-modules-core',
            'expo-router',
        ]);

        expect(listCuratedBaseBundleDependenciesWithExpo()).toEqual([
            { specifier: 'react', packageName: 'react' },
            { specifier: 'react/jsx-runtime', packageName: 'react' },
            { specifier: 'react-native', packageName: 'react-native' },
            {
                specifier: 'react-native-safe-area-context',
                packageName: 'react-native-safe-area-context',
            },
            { specifier: 'expo-status-bar', packageName: 'expo-status-bar' },
            { specifier: 'expo', packageName: 'expo' },
            { specifier: 'expo-constants', packageName: 'expo-constants' },
            { specifier: 'expo-modules-core', packageName: 'expo-modules-core' },
            { specifier: 'expo-router', packageName: 'expo-router' },
        ]);
    });

    test('recognizes curated Expo specifiers', () => {
        expect(isCuratedExpoBundleDependencySpecifier('expo')).toBe(true);
        expect(isCuratedExpoBundleDependencySpecifier('expo-router')).toBe(true);
        expect(isCuratedExpoBundleDependencySpecifier('expo-status-bar')).toBe(true);
        expect(isCuratedExpoBundleDependencySpecifier('react')).toBe(false);
        expect(isCuratedExpoBundleDependencySpecifier('@expo/vector-icons')).toBe(false);
    });
});

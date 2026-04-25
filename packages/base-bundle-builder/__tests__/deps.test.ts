import { describe, expect, test } from 'bun:test';
import {
    isCuratedBaseBundleDependencySpecifier,
    listCuratedBaseBundleDependencies,
    listCuratedBaseBundleDependencySpecifiers,
} from '../src/deps';

describe('base-bundle dependency curation', () => {
    test('groups the React and Expo specifiers for the base bundle', () => {
        expect(listCuratedBaseBundleDependencySpecifiers('base')).toEqual([
            'react',
            'react/jsx-runtime',
            'react-native',
            'react-native-safe-area-context',
        ]);
        expect(listCuratedBaseBundleDependencySpecifiers('expo')).toEqual([
            'expo-status-bar',
        ]);
    });

    test('lists the full curated dependency set in order', () => {
        expect(listCuratedBaseBundleDependencySpecifiers()).toEqual([
            'react',
            'react/jsx-runtime',
            'react-native',
            'react-native-safe-area-context',
            'expo-status-bar',
        ]);

        expect(listCuratedBaseBundleDependencies()).toEqual([
            { specifier: 'react', packageName: 'react' },
            { specifier: 'react/jsx-runtime', packageName: 'react' },
            { specifier: 'react-native', packageName: 'react-native' },
            {
                specifier: 'react-native-safe-area-context',
                packageName: 'react-native-safe-area-context',
            },
            { specifier: 'expo-status-bar', packageName: 'expo-status-bar' },
        ]);
    });

    test('recognizes curated base-bundle specifiers', () => {
        expect(isCuratedBaseBundleDependencySpecifier('react')).toBe(true);
        expect(isCuratedBaseBundleDependencySpecifier('react/jsx-runtime')).toBe(true);
        expect(isCuratedBaseBundleDependencySpecifier('expo-status-bar')).toBe(true);
        expect(isCuratedBaseBundleDependencySpecifier('expo')).toBe(false);
        expect(isCuratedBaseBundleDependencySpecifier('@expo/vector-icons')).toBe(false);
    });
});

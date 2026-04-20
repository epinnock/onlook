import {
    listCuratedBaseBundleDependencies,
    listCuratedBaseBundleDependencySpecifiers,
    type CuratedBaseBundleDependency,
    type CuratedBaseBundleDependencySpecifier,
} from './deps';

type CuratedDependency = {
    readonly specifier: string;
    readonly packageName: string;
};

const curatedExpoBundleDependencyGroups = {
    expo: [
        { specifier: 'expo', packageName: 'expo' },
        { specifier: 'expo-constants', packageName: 'expo-constants' },
        { specifier: 'expo-modules-core', packageName: 'expo-modules-core' },
        { specifier: 'expo-router', packageName: 'expo-router' },
        { specifier: 'expo-status-bar', packageName: 'expo-status-bar' },
        {
            specifier: 'react-native-safe-area-context',
            packageName: 'react-native-safe-area-context',
        },
    ],
} as const satisfies Record<'expo', readonly CuratedDependency[]>;

export type CuratedExpoBundleDependencyGroup = keyof typeof curatedExpoBundleDependencyGroups;

export type CuratedExpoBundleDependency =
    (typeof curatedExpoBundleDependencyGroups)[CuratedExpoBundleDependencyGroup][number];

export type CuratedExpoBundleDependencySpecifier = CuratedExpoBundleDependency['specifier'];

const curatedExpoBundleDependencySpecifiersByGroup = {
    expo: curatedExpoBundleDependencyGroups.expo.map(({ specifier }) => specifier),
} as const satisfies Record<
    CuratedExpoBundleDependencyGroup,
    readonly CuratedExpoBundleDependencySpecifier[]
>;

const curatedExpoBundleDependencySpecifiers = [
    ...curatedExpoBundleDependencySpecifiersByGroup.expo,
] as const satisfies readonly CuratedExpoBundleDependencySpecifier[];

const curatedExpoBundleDependencySpecifierSet = new Set<string>(
    curatedExpoBundleDependencySpecifiers,
);

export function listCuratedExpoBundleDependencies(
    group?: CuratedExpoBundleDependencyGroup,
): readonly CuratedExpoBundleDependency[] {
    if (group) {
        return curatedExpoBundleDependencyGroups[group];
    }

    return [...curatedExpoBundleDependencyGroups.expo];
}

export function listCuratedExpoBundleDependencySpecifiers(
    group?: CuratedExpoBundleDependencyGroup,
): readonly CuratedExpoBundleDependencySpecifier[] {
    if (group) {
        return curatedExpoBundleDependencySpecifiersByGroup[group];
    }

    return curatedExpoBundleDependencySpecifiers;
}

export function isCuratedExpoBundleDependencySpecifier(
    specifier: string,
): specifier is CuratedExpoBundleDependencySpecifier {
    return curatedExpoBundleDependencySpecifierSet.has(specifier);
}

export function mergeCuratedDependencySpecifiers<T extends string>(
    ...specifierLists: readonly (readonly T[])[]
): readonly T[] {
    const merged: T[] = [];
    const seenSpecifiers = new Set<string>();

    for (const specifierList of specifierLists) {
        for (const specifier of specifierList) {
            if (seenSpecifiers.has(specifier)) {
                continue;
            }

            seenSpecifiers.add(specifier);
            merged.push(specifier);
        }
    }

    return merged;
}

export function mergeCuratedDependencyLists(
    ...dependencyLists: readonly (readonly CuratedDependency[])[]
): readonly CuratedDependency[] {
    const merged: CuratedDependency[] = [];
    const seenSpecifiers = new Set<string>();

    for (const dependencyList of dependencyLists) {
        for (const dependency of dependencyList) {
            if (seenSpecifiers.has(dependency.specifier)) {
                continue;
            }

            seenSpecifiers.add(dependency.specifier);
            merged.push(dependency);
        }
    }

    return merged;
}

export function listCuratedBaseBundleDependencySpecifiersWithExpo(): readonly (
    CuratedBaseBundleDependencySpecifier | CuratedExpoBundleDependencySpecifier
)[] {
    return mergeCuratedDependencySpecifiers(
        listCuratedBaseBundleDependencySpecifiers(),
        listCuratedExpoBundleDependencySpecifiers(),
    );
}

export function listCuratedBaseBundleDependenciesWithExpo(): readonly CuratedDependency[] {
    return mergeCuratedDependencyLists(
        listCuratedBaseBundleDependencies(),
        listCuratedExpoBundleDependencies(),
    );
}

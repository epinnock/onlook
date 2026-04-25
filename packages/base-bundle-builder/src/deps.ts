const curatedBaseBundleDependencyGroups = {
    base: [
        { specifier: 'react', packageName: 'react' },
        { specifier: 'react/jsx-runtime', packageName: 'react' },
        { specifier: 'react-native', packageName: 'react-native' },
        {
            specifier: 'react-native-safe-area-context',
            packageName: 'react-native-safe-area-context',
        },
    ],
    expo: [{ specifier: 'expo-status-bar', packageName: 'expo-status-bar' }],
} as const;

export type CuratedBaseBundleDependencyGroup =
    keyof typeof curatedBaseBundleDependencyGroups;

export type CuratedBaseBundleDependency =
    (typeof curatedBaseBundleDependencyGroups)[CuratedBaseBundleDependencyGroup][number];

export type CuratedBaseBundleDependencySpecifier =
    CuratedBaseBundleDependency['specifier'];

const curatedBaseBundleDependencySpecifiersByGroup = {
    base: curatedBaseBundleDependencyGroups.base.map(({ specifier }) => specifier),
    expo: curatedBaseBundleDependencyGroups.expo.map(({ specifier }) => specifier),
} as const satisfies Record<
    CuratedBaseBundleDependencyGroup,
    readonly CuratedBaseBundleDependencySpecifier[]
>;

const curatedBaseBundleDependencySpecifiers = [
    ...curatedBaseBundleDependencySpecifiersByGroup.base,
    ...curatedBaseBundleDependencySpecifiersByGroup.expo,
] as const satisfies readonly CuratedBaseBundleDependencySpecifier[];

const curatedBaseBundleDependencySpecifierSet = new Set<string>(
    curatedBaseBundleDependencySpecifiers,
);

export function listCuratedBaseBundleDependencies(
    group?: CuratedBaseBundleDependencyGroup,
): readonly CuratedBaseBundleDependency[] {
    if (group) {
        return curatedBaseBundleDependencyGroups[group];
    }

    return [
        ...curatedBaseBundleDependencyGroups.base,
        ...curatedBaseBundleDependencyGroups.expo,
    ];
}

export function listCuratedBaseBundleDependencySpecifiers(
    group?: CuratedBaseBundleDependencyGroup,
): readonly CuratedBaseBundleDependencySpecifier[] {
    if (group) {
        return curatedBaseBundleDependencySpecifiersByGroup[group];
    }

    return curatedBaseBundleDependencySpecifiers;
}

export function isCuratedBaseBundleDependencySpecifier(
    specifier: string,
): specifier is CuratedBaseBundleDependencySpecifier {
    return curatedBaseBundleDependencySpecifierSet.has(specifier);
}

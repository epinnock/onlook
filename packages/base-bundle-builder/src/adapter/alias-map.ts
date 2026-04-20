export interface AliasMapEntry {
    readonly specifier: string;
    readonly moduleId: number;
}

export interface AliasMap {
    readonly entries: readonly AliasMapEntry[];
    readonly specifiers: readonly string[];
    readonly moduleIdsBySpecifier: ReadonlyMap<string, number>;
}

export type AliasMapInput = ReadonlyArray<AliasMapEntry> | Readonly<Record<string, number>>;

const ALIAS_MAP_ERROR_PREFIX = 'Alias map';

export function createAliasMap(input: AliasMapInput): AliasMap {
    const entries = normalizeAliasMapEntries(input);
    const moduleIdsBySpecifier = new Map<string, number>();

    for (const { specifier, moduleId } of entries) {
        assertNonEmptySpecifier(specifier);
        assertIntegerModuleId(moduleId, specifier);

        if (moduleIdsBySpecifier.has(specifier)) {
            throw new Error(`${ALIAS_MAP_ERROR_PREFIX} contains duplicate specifier "${specifier}"`);
        }

        moduleIdsBySpecifier.set(specifier, moduleId);
    }

    return {
        entries,
        specifiers: entries.map(({ specifier }) => specifier),
        moduleIdsBySpecifier,
    };
}

export function hasAliasMapSpecifier(aliasMap: AliasMap, specifier: string): boolean {
    return aliasMap.moduleIdsBySpecifier.has(specifier);
}

export function getAliasMapModuleId(aliasMap: AliasMap, specifier: string): number {
    const moduleId = aliasMap.moduleIdsBySpecifier.get(specifier);

    if (moduleId === undefined) {
        throw new Error(
            `${ALIAS_MAP_ERROR_PREFIX} does not contain an entry for "${specifier}". Known specifiers: ${aliasMap.specifiers.join(', ') || '(none)'}`,
        );
    }

    return moduleId;
}

export function listAliasMapSpecifiers(aliasMap: AliasMap): readonly string[] {
    return aliasMap.specifiers;
}

function normalizeAliasMapEntries(
    input: AliasMapInput,
): readonly AliasMapEntry[] {
    if (Array.isArray(input)) {
        return input;
    }

    return Object.entries(input).map(([specifier, moduleId]) => ({
        specifier,
        moduleId,
    }));
}

function assertNonEmptySpecifier(specifier: string): void {
    if (specifier.trim().length === 0) {
        throw new Error(`${ALIAS_MAP_ERROR_PREFIX} specifier must be a non-empty string`);
    }
}

function assertIntegerModuleId(moduleId: number, specifier: string): void {
    if (!Number.isInteger(moduleId)) {
        throw new Error(
            `${ALIAS_MAP_ERROR_PREFIX} entry for "${specifier}" must use an integer module id`,
        );
    }
}

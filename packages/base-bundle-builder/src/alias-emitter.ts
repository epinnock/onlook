import {
    createAliasMap,
    getAliasMapModuleId,
    listAliasMapSpecifiers,
    type AliasMap,
    type AliasMapEntry,
    type AliasMapInput,
} from './adapter/alias-map';

export type AliasEmitterInput = AliasMapInput;

export interface AliasEmitterSidecar {
    readonly aliases: Readonly<Record<string, number>>;
    readonly specifiers: readonly string[];
}

export interface AliasEmitterOutput {
    readonly aliasMap: AliasMap;
    readonly sidecar: AliasEmitterSidecar;
    readonly sidecarJson: string;
}

export function createAliasEmitterOutput(
    input: AliasEmitterInput,
): AliasEmitterOutput {
    const aliasMap = createAliasMap(normalizeAliasEmitterInput(input));
    const sidecar = createAliasEmitterSidecar(aliasMap);

    return {
        aliasMap,
        sidecar,
        sidecarJson: JSON.stringify(sidecar),
    };
}

export function createAliasEmitterSidecar(
    aliasMap: AliasMap,
): AliasEmitterSidecar {
    const aliases: Record<string, number> = {};
    const specifiers = [...listAliasMapSpecifiers(aliasMap)].sort();

    for (const specifier of specifiers) {
        aliases[specifier] = getAliasMapModuleId(aliasMap, specifier);
    }

    return {
        aliases,
        specifiers,
    };
}

export function stringifyAliasEmitterSidecar(
    aliasMap: AliasMap,
): string {
    return JSON.stringify(createAliasEmitterSidecar(aliasMap));
}

function normalizeAliasEmitterInput(
    input: AliasEmitterInput,
): readonly AliasMapEntry[] {
    const entries = Array.isArray(input)
        ? input
        : Object.entries(input).map(([specifier, moduleId]) => ({
            specifier,
            moduleId,
        }));

    return [...entries].sort(compareAliasMapEntries);
}

function compareAliasMapEntries(
    left: AliasMapEntry,
    right: AliasMapEntry,
): number {
    if (left.specifier < right.specifier) {
        return -1;
    }

    if (left.specifier > right.specifier) {
        return 1;
    }

    return left.moduleId - right.moduleId;
}

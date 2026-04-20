import {
    createAliasMap,
    getAliasMapModuleId,
    listAliasMapSpecifiers,
    type AliasMap,
    type AliasMapEntry,
    type AliasMapInput,
} from './adapter/alias-map';

export interface AliasEmitterModuleRecord {
    readonly id?: number;
    readonly moduleId?: number;
    readonly path?: string;
    readonly specifier?: string;
}

export interface AliasEmitterModuleGraphInput {
    readonly modules: readonly AliasEmitterModuleRecord[];
}

export type AliasEmitterInput = AliasMapInput | AliasEmitterModuleGraphInput;

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
    if (isAliasEmitterModuleGraphInput(input)) {
        return normalizeAliasEmitterModuleGraphInput(input);
    }

    const entries = Array.isArray(input)
        ? input
        : Object.entries(input).map(([specifier, moduleId]) => ({
            specifier,
            moduleId,
        }));

    return [...entries].sort(compareAliasMapEntries);
}

function normalizeAliasEmitterModuleGraphInput(
    input: AliasEmitterModuleGraphInput,
): readonly AliasMapEntry[] {
    return input.modules
        .flatMap((module) => {
            const specifier = getAliasEmitterModuleSpecifier(module);
            const moduleId = getAliasEmitterModuleId(module);

            if (specifier === undefined || moduleId === undefined) {
                return [];
            }

            return [{ specifier, moduleId }];
        })
        .sort(compareAliasMapEntries);
}

function isAliasEmitterModuleGraphInput(
    input: AliasEmitterInput,
): input is AliasEmitterModuleGraphInput {
    return (
        typeof input === 'object' &&
        input !== null &&
        !Array.isArray(input) &&
        Array.isArray((input as { modules?: unknown }).modules)
    );
}

function getAliasEmitterModuleSpecifier(
    module: AliasEmitterModuleRecord,
): string | undefined {
    if (typeof module.specifier !== 'string') {
        return undefined;
    }

    const specifier = module.specifier.trim();
    return specifier.length === 0 ? undefined : specifier;
}

function getAliasEmitterModuleId(
    module: AliasEmitterModuleRecord,
): number | undefined {
    if (typeof module.moduleId === 'number') {
        return module.moduleId;
    }

    if (typeof module.id === 'number') {
        return module.id;
    }

    return undefined;
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

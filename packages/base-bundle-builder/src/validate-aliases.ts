import { listAliasMapSpecifiers, type AliasMap } from './adapter/alias-map';
import { listCuratedBaseBundleDependencySpecifiers } from './deps';
import { REQUIRED_ALIASES } from './runtime-capabilities';

export interface AliasMapValidationResult {
    readonly isComplete: boolean;
    readonly missingSpecifiers: readonly string[];
    readonly extraSpecifiers: readonly string[];
    /**
     * Task #11 — ABI v1 REQUIRED_ALIASES that must be present in every base
     * bundle. Always a subset of `missingSpecifiers` when present. Separated so
     * callers can route required-alias violations to a harder error than curated-
     * dep drift (which might just be a newly-added dep not yet in the alias map).
     */
    readonly missingRequiredAliases: readonly string[];
}

const ALIAS_VALIDATION_ERROR_PREFIX = 'Alias map';

export function validateAliasMapCompleteness(
    aliasMap: AliasMap,
): AliasMapValidationResult {
    const aliasSpecifiers = new Set(listAliasMapSpecifiers(aliasMap));
    const curatedSpecifiers = listCuratedBaseBundleDependencySpecifiers();
    const curatedSpecifiersSet = new Set<string>(curatedSpecifiers);

    const missingSpecifiers = curatedSpecifiers.filter(
        (specifier) => !aliasSpecifiers.has(specifier),
    );
    const extraSpecifiers = listAliasMapSpecifiers(aliasMap).filter(
        (specifier) => !curatedSpecifiersSet.has(specifier),
    );

    const missingRequiredAliases = REQUIRED_ALIASES.filter(
        (spec) => !aliasSpecifiers.has(spec),
    );

    return {
        isComplete: missingSpecifiers.length === 0,
        missingSpecifiers,
        extraSpecifiers,
        missingRequiredAliases,
    };
}

export function assertAliasMapCompleteness(aliasMap: AliasMap): void {
    const validationResult = validateAliasMapCompleteness(aliasMap);

    if (validationResult.missingRequiredAliases.length > 0) {
        throw new Error(
            `${ALIAS_VALIDATION_ERROR_PREFIX} is missing REQUIRED_ALIASES (ABI v1 task #11): ${validationResult.missingRequiredAliases.map((s) => `"${s}"`).join(', ')}. Every base bundle must serve these via OnlookRuntime.require.`,
        );
    }

    if (validationResult.missingSpecifiers.length === 0) {
        return;
    }

    throw new Error(
        `${ALIAS_VALIDATION_ERROR_PREFIX} is missing curated base-bundle specifiers: ${validationResult.missingSpecifiers.map((specifier) => `"${specifier}"`).join(', ')}. Known aliases: ${listAliasMapSpecifiers(aliasMap).join(', ') || '(none)'}`,
    );
}

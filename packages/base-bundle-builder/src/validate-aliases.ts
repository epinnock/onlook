import { listAliasMapSpecifiers, type AliasMap } from './adapter/alias-map';
import { listCuratedBaseBundleDependencySpecifiers } from './deps';

export interface AliasMapValidationResult {
    readonly isComplete: boolean;
    readonly missingSpecifiers: readonly string[];
    readonly extraSpecifiers: readonly string[];
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

    return {
        isComplete: missingSpecifiers.length === 0,
        missingSpecifiers,
        extraSpecifiers,
    };
}

export function assertAliasMapCompleteness(aliasMap: AliasMap): void {
    const validationResult = validateAliasMapCompleteness(aliasMap);

    if (validationResult.missingSpecifiers.length === 0) {
        return;
    }

    throw new Error(
        `${ALIAS_VALIDATION_ERROR_PREFIX} is missing curated base-bundle specifiers: ${validationResult.missingSpecifiers.map((specifier) => `"${specifier}"`).join(', ')}. Known aliases: ${listAliasMapSpecifiers(aliasMap).join(', ') || '(none)'}`,
    );
}

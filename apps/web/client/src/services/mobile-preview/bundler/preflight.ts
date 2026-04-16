import { SUPPORTED_BARE_IMPORTS } from './constants';
import { findImportSpecifiers } from './imports';
import { isBareSpecifier } from './path-utils';
import { resolveProjectSpecifier } from './resolution';
import { MobilePreviewBundleError } from './types';

export const MOBILE_PREVIEW_SUPPORTED_BARE_IMPORTS = new Set(
    SUPPORTED_BARE_IMPORTS,
);

export interface UnsupportedMobilePreviewImport {
    importerPath: string;
    specifier: string;
}

export function isMobilePreviewSupportedBareImport(specifier: string): boolean {
    return MOBILE_PREVIEW_SUPPORTED_BARE_IMPORTS.has(specifier);
}

export function formatUnsupportedMobilePreviewImports(
    imports: UnsupportedMobilePreviewImport[],
): string {
    const details = imports
        .map(
            ({ importerPath, specifier }) =>
                `- ${JSON.stringify(specifier)} (imported by ${importerPath})`,
        )
        .join('\n');

    return [
        'Mobile preview does not support these package imports yet:',
        details,
        `Supported bare imports: ${Array.from(
            MOBILE_PREVIEW_SUPPORTED_BARE_IMPORTS,
        )
            .sort()
            .join(', ')}.`,
    ].join('\n');
}

export function collectUnsupportedMobilePreviewImports(
    files: Map<string, string>,
    entryPath: string,
): UnsupportedMobilePreviewImport[] {
    const unsupportedImports = new Map<string, UnsupportedMobilePreviewImport>();
    const visited = new Set<string>();
    const visiting = new Set<string>();

    const visit = (filePath: string) => {
        if (visited.has(filePath) || visiting.has(filePath)) {
            return;
        }

        visiting.add(filePath);
        const source = files.get(filePath);
        if (source == null) {
            visiting.delete(filePath);
            return;
        }

        for (const specifier of findImportSpecifiers(source)) {
            const resolved = resolveProjectSpecifier(specifier, filePath, files);
            if (resolved != null) {
                visit(resolved);
                continue;
            }

            if (
                isBareSpecifier(specifier) &&
                !isMobilePreviewSupportedBareImport(specifier)
            ) {
                const key = `${filePath}::${specifier}`;
                if (!unsupportedImports.has(key)) {
                    unsupportedImports.set(key, {
                        importerPath: filePath,
                        specifier,
                    });
                }
            }
        }

        visiting.delete(filePath);
        visited.add(filePath);
    };

    visit(entryPath);
    return Array.from(unsupportedImports.values()).sort((left, right) => {
        const specifierDiff = left.specifier.localeCompare(right.specifier);
        return specifierDiff !== 0
            ? specifierDiff
            : left.importerPath.localeCompare(right.importerPath);
    });
}

export function preflightUnsupportedMobilePreviewImports(
    files: Map<string, string>,
    entryPath: string,
): void {
    const unsupportedImports = collectUnsupportedMobilePreviewImports(
        files,
        entryPath,
    );

    if (unsupportedImports.length === 0) {
        return;
    }

    throw new MobilePreviewBundleError(
        formatUnsupportedMobilePreviewImports(unsupportedImports),
    );
}

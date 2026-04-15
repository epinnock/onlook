import { SUPPORTED_BARE_IMPORTS } from './constants';
import { findImportSpecifiers } from './imports';
import { isBareSpecifier } from './path-utils';
import { resolveProjectSpecifier } from './resolution';
import { MobilePreviewBundleError } from './types';

export function collectDependencyGraph(
    files: Map<string, string>,
    entryPath: string,
): string[] {
    const ordered = new Set<string>();
    const visiting = new Set<string>();

    const visit = (filePath: string) => {
        if (ordered.has(filePath)) {
            return;
        }
        if (visiting.has(filePath)) {
            return;
        }

        visiting.add(filePath);
        const source = files.get(filePath);
        if (source == null) {
            throw new MobilePreviewBundleError(
                `Module "${filePath}" was referenced but is missing from the project.`,
            );
        }

        for (const specifier of findImportSpecifiers(source)) {
            const resolved = resolveProjectSpecifier(specifier, filePath, files);
            if (resolved == null) {
                if (isBareSpecifier(specifier) && !SUPPORTED_BARE_IMPORTS.has(specifier)) {
                    throw new MobilePreviewBundleError(
                        `Unsupported package import "${specifier}" in ${filePath}. Mobile preview currently supports only ${Array.from(
                            SUPPORTED_BARE_IMPORTS,
                        ).join(', ')}.`,
                    );
                }
                continue;
            }
            visit(resolved);
        }

        visiting.delete(filePath);
        ordered.add(filePath);
    };

    visit(entryPath);
    return Array.from(ordered);
}

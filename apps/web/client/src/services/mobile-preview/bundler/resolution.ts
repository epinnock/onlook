import { ENTRY_CANDIDATES, RESOLVABLE_EXTENSIONS } from './constants';
import { dirname, joinPath, normalizePath } from './path-utils';
import { MobilePreviewBundleError } from './types';

export function resolveEntryPath(files: Map<string, string>): string {
    const packageJson = files.get('package.json');
    if (packageJson) {
        try {
            const parsed = JSON.parse(packageJson) as { main?: string };
            const packageMain = parsed.main?.trim();
            if (packageMain) {
                const resolvedFromMain = resolveProjectSpecifier(packageMain, '', files);
                if (resolvedFromMain != null) {
                    return resolvedFromMain;
                }
            }
        } catch {
            // Ignore malformed package.json here and fall back to conventions.
        }
    }

    for (const candidate of ENTRY_CANDIDATES) {
        if (files.has(candidate)) {
            return candidate;
        }
    }

    throw new MobilePreviewBundleError(
        `No entry file found. Tried ${ENTRY_CANDIDATES.join(', ')}.`,
    );
}

export function resolveProjectSpecifier(
    specifier: string,
    importerPath: string,
    files: Map<string, string>,
): string | null {
    if (!specifier) {
        return null;
    }

    if (specifier.startsWith('@/') || specifier.startsWith('~/')) {
        return resolveFileCandidate(specifier.slice(2), files);
    }

    if (specifier.startsWith('/')) {
        return resolveFileCandidate(specifier.slice(1), files);
    }

    if (specifier.startsWith('.')) {
        const importerDir = dirname(importerPath);
        return resolveFileCandidate(joinPath(importerDir, specifier), files);
    }

    return null;
}

function resolveFileCandidate(
    rawPath: string,
    files: Map<string, string>,
): string | null {
    const normalizedPath = normalizePath(rawPath);
    if (files.has(normalizedPath)) {
        return normalizedPath;
    }

    for (const extension of RESOLVABLE_EXTENSIONS) {
        const withExtension = `${normalizedPath}${extension}`;
        if (files.has(withExtension)) {
            return withExtension;
        }
    }

    for (const extension of RESOLVABLE_EXTENSIONS) {
        const indexPath = joinPath(normalizedPath, `index${extension}`);
        if (files.has(indexPath)) {
            return indexPath;
        }
    }

    return null;
}

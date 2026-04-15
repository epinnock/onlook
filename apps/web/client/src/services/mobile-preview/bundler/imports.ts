import { LOCAL_IMPORT_RE } from './constants';

export function findImportSpecifiers(source: string): string[] {
    const specifiers = new Set<string>();

    for (const match of source.matchAll(LOCAL_IMPORT_RE)) {
        const specifier = match[1] ?? match[2] ?? match[3];
        if (specifier) {
            specifiers.add(specifier);
        }
    }

    return Array.from(specifiers);
}

export function normalizePath(inputPath: string): string {
    const parts = inputPath.replaceAll('\\', '/').split('/');
    const normalized: string[] = [];

    for (const part of parts) {
        if (!part || part === '.') {
            continue;
        }
        if (part === '..') {
            normalized.pop();
            continue;
        }
        normalized.push(part);
    }

    return normalized.join('/');
}

export function dirname(filePath: string): string {
    const normalizedPath = normalizePath(filePath);
    const parts = normalizedPath.split('/');
    parts.pop();
    return parts.join('/');
}

export function joinPath(...parts: string[]): string {
    return normalizePath(parts.filter(Boolean).join('/'));
}

export function isBareSpecifier(specifier: string): boolean {
    return (
        !specifier.startsWith('.') &&
        !specifier.startsWith('/') &&
        !specifier.startsWith('@/') &&
        !specifier.startsWith('~/')
    );
}

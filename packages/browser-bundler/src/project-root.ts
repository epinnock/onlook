import type { VirtualFsFileMap } from './plugins/virtual-fs-resolve';

const MANIFEST_NAMES = ['package.json', 'app.json'] as const;

export function findVirtualProjectRoot(entryPoint: string, files: VirtualFsFileMap): string {
    const normalizedEntryPoint = normalizeVirtualPath(entryPoint);
    const normalizedFiles = new Set<string>();

    for (const filePath of Object.keys(files)) {
        normalizedFiles.add(normalizeVirtualPath(filePath));
    }

    let currentDir = dirnameVirtualPath(normalizedEntryPoint);

    while (true) {
        for (const manifestName of MANIFEST_NAMES) {
            if (normalizedFiles.has(joinVirtualPath(currentDir, manifestName))) {
                return currentDir;
            }
        }

        if (currentDir.length === 0) {
            break;
        }

        currentDir = dirnameVirtualPath(currentDir);
    }

    throw new Error(`Unable to determine project root for "${entryPoint}"`);
}

function joinVirtualPath(baseDir: string, childPath: string): string {
    if (baseDir.length === 0) {
        return normalizeVirtualPath(childPath);
    }

    return normalizeVirtualPath(`${baseDir}/${childPath}`);
}

function dirnameVirtualPath(path: string): string {
    const normalized = normalizeVirtualPath(path);
    const slashIndex = normalized.lastIndexOf('/');

    if (slashIndex === -1) {
        return '';
    }

    return normalized.slice(0, slashIndex);
}

function normalizeVirtualPath(path: string): string {
    const normalizedSeparators = path.replace(/\\/g, '/');
    const trimmed = normalizedSeparators.replace(/^\/+/, '');
    const segments = trimmed.split('/');
    const resolved: string[] = [];

    for (const segment of segments) {
        if (segment.length === 0 || segment === '.') {
            continue;
        }

        if (segment === '..') {
            const last = resolved[resolved.length - 1];
            if (last !== undefined && last !== '..') {
                resolved.pop();
            } else {
                resolved.push(segment);
            }
            continue;
        }

        resolved.push(segment);
    }

    return resolved.join('/');
}

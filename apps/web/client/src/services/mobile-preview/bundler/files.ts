import { inlineImageAsset, isImageAssetPath } from './asset-loader';
import { SOURCE_EXTENSIONS } from './constants';
import { normalizePath } from './path-utils';
import type { MobilePreviewVfs } from './types';

export function shouldSyncMobilePreviewPath(filePath: string): boolean {
    const normalizedPath = normalizePath(filePath);
    if (!normalizedPath) {
        return false;
    }
    if (normalizedPath.includes('node_modules')) {
        return false;
    }
    if (normalizedPath.includes('.onlook/')) {
        return false;
    }
    if (
        normalizedPath === 'package-lock.json' ||
        normalizedPath === 'bun.lock' ||
        normalizedPath === 'bun.lockb'
    ) {
        return false;
    }
    return (
        SOURCE_EXTENSIONS.some((extension) => normalizedPath.endsWith(extension)) ||
        isImageAssetPath(normalizedPath) ||
        normalizedPath === 'package.json'
    );
}

export async function readProjectFiles(
    vfs: MobilePreviewVfs,
): Promise<Map<string, string>> {
    const entries = await vfs.listAll();
    const files = new Map<string, string>();

    for (const entry of entries) {
        if (entry.type !== 'file') {
            continue;
        }

        const normalizedPath = normalizePath(entry.path);
        if (!shouldSyncMobilePreviewPath(normalizedPath)) {
            continue;
        }

        const raw = await vfs.readFile(normalizedPath);
        if (isImageAssetPath(normalizedPath)) {
            files.set(normalizedPath, inlineImageAsset(normalizedPath, raw));
            continue;
        }

        files.set(
            normalizedPath,
            typeof raw === 'string' ? raw : new TextDecoder().decode(raw),
        );
    }

    return files;
}

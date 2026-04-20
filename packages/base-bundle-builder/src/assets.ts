export interface BaseBundleAssetRecord {
    readonly path: string;
    readonly hash?: string;
    readonly key?: string;
    readonly contentType: string;
    readonly byteLength: number;
}

export interface BaseBundleAssetManifestEntry {
    readonly path: string;
    readonly key: string;
    readonly contentType: string;
    readonly byteLength: number;
}

export interface BaseBundleAssetManifest {
    readonly assets: readonly BaseBundleAssetManifestEntry[];
}

export type BaseBundleAssetSource =
    | readonly BaseBundleAssetRecord[]
    | {
          readonly assets?: readonly BaseBundleAssetRecord[];
      }
    | null
    | undefined;

export interface CreateBaseBundleAssetManifestInput {
    readonly buildOutput?: BaseBundleAssetSource;
    readonly metadata?: BaseBundleAssetSource;
}

export function createBaseBundleAssetManifest(
    input: CreateBaseBundleAssetManifestInput,
): BaseBundleAssetManifest {
    return extractBaseBundleAssetManifest(input.buildOutput, input.metadata);
}

export function extractBaseBundleAssetManifest(
    ...sources: readonly BaseBundleAssetSource[]
): BaseBundleAssetManifest {
    const assetsByKey = new Map<string, BaseBundleAssetManifestEntry>();

    for (const source of sources) {
        for (const record of collectBaseBundleAssetRecords(source)) {
            const entry = normalizeBaseBundleAssetRecord(record);
            assetsByKey.set(entry.key, entry);
        }
    }

    return {
        assets: [...assetsByKey.values()],
    };
}

export function normalizeBaseBundleAssetKey(input: {
    readonly path: string;
    readonly hash?: string;
    readonly key?: string;
}): string {
    const normalizedPath = normalizeBaseBundleAssetPath(input.path);
    const hashOrKey = input.hash ?? input.key;

    if (typeof hashOrKey !== 'string' || hashOrKey.trim().length === 0) {
        throw new Error('Base bundle asset hash/key must be a non-empty string');
    }

    const assetId = normalizeBaseBundleAssetSegment(hashOrKey, 'hash/key');
    const filename = getBaseBundleAssetFilename(normalizedPath);

    return `assets/${assetId}/${filename}`;
}

export function normalizeBaseBundleAssetPath(path: string): string {
    if (typeof path !== 'string' || path.trim().length === 0) {
        throw new Error('Base bundle asset path must be a non-empty string');
    }

    const normalizedPath = path.replace(/\\/g, '/');
    const segments = normalizedPath.split('/');

    if (
        normalizedPath.startsWith('/') ||
        segments.some((segment) => segment.length === 0 || segment === '.' || segment === '..')
    ) {
        throw new Error(
            `Base bundle asset path must be a non-empty relative path without traversal: ${path}`,
        );
    }

    return normalizedPath;
}

function collectBaseBundleAssetRecords(
    source: BaseBundleAssetSource,
): readonly BaseBundleAssetRecord[] {
    if (source === null || source === undefined) {
        return [];
    }

    if (Array.isArray(source)) {
        return source;
    }

    if (!('assets' in source)) {
        return [];
    }

    return source.assets ?? [];
}

function normalizeBaseBundleAssetRecord(
    record: BaseBundleAssetRecord,
): BaseBundleAssetManifestEntry {
    const path = normalizeBaseBundleAssetPath(record.path);
    const key = normalizeBaseBundleAssetKey({
        path,
        hash: record.hash,
        key: record.key,
    });

    if (typeof record.contentType !== 'string' || record.contentType.trim().length === 0) {
        throw new Error('Base bundle asset contentType must be a non-empty string');
    }

    if (!Number.isInteger(record.byteLength) || record.byteLength < 0) {
        throw new Error('Base bundle asset byteLength must be a non-negative integer');
    }

    return {
        path,
        key,
        contentType: record.contentType,
        byteLength: record.byteLength,
    };
}

function normalizeBaseBundleAssetSegment(value: string, fieldName: string): string {
    const normalizedValue = value.replace(/\\/g, '/');
    const segments = normalizedValue.split('/');
    const segment = segments[0];

    if (
        normalizedValue.trim().length === 0 ||
        segments.length !== 1 ||
        segment === undefined ||
        segment.length === 0 ||
        segment === '.' ||
        segment === '..'
    ) {
        throw new Error(`Base bundle asset ${fieldName} must be a single non-empty path segment`);
    }

    return segment;
}

function getBaseBundleAssetFilename(path: string): string {
    const segments = path.split('/');
    const filename = segments[segments.length - 1];

    if (filename === undefined || filename.length === 0) {
        throw new Error('Base bundle asset path must include a filename');
    }

    return filename;
}

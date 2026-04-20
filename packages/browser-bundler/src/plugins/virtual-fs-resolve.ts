const PROBED_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx'] as const;

export type VirtualFsFileMap = Readonly<Record<string, string>>;

export interface VirtualFsResolveResult {
    path?: string;
    external?: boolean;
    namespace?: string;
}

export interface VirtualFsResolveArgs {
    path: string;
    importer: string;
    namespace?: string;
    resolveDir?: string;
}

export interface VirtualFsResolveBuild {
    onResolve(
        options: { filter: RegExp; namespace?: string },
        callback: (
            args: VirtualFsResolveArgs,
        ) => VirtualFsResolveResult | Promise<VirtualFsResolveResult> | undefined | void,
    ): void;
}

export interface VirtualFsResolvePlugin {
    name: string;
    setup(build: VirtualFsResolveBuild): void;
}

export interface CreateVirtualFsResolvePluginOptions {
    files: VirtualFsFileMap;
    namespace?: string;
}

export function createVirtualFsResolvePlugin(options: CreateVirtualFsResolvePluginOptions): VirtualFsResolvePlugin {
    return {
        name: 'virtual-fs-resolve',
        setup(build) {
            build.onResolve(
                { filter: /^\.\.?\//, namespace: options.namespace },
                (args) => {
                    const resolved = resolveVirtualFsImport(args.path, args.importer, options.files);

                    if (resolved === undefined) {
                        return undefined;
                    }

                    return { path: resolved };
                },
            );
        },
    };
}

export function resolveVirtualFsImport(
    specifier: string,
    importer: string,
    files: VirtualFsFileMap,
): string | undefined {
    if (!isRelativeSpecifier(specifier)) {
        return undefined;
    }

    const importerPath = normalizeVirtualPath(importer);
    const importerDir = dirnameVirtualPath(importerPath);
    const resolvedBase = normalizeVirtualPath(joinVirtualPath(importerDir, specifier));

    const exactMatch = findVirtualFile(resolvedBase, files);
    if (exactMatch !== undefined) {
        return exactMatch;
    }

    const supportsExtension = hasSupportedExtension(resolvedBase);
    const probeCandidates = supportsExtension ? [] : buildProbeCandidates(resolvedBase);
    for (const candidate of probeCandidates) {
        const match = findVirtualFile(candidate, files);
        if (match !== undefined) {
            return match;
        }
    }

    throw new Error(`Unable to resolve virtual import "${specifier}" from "${importer}"`);
}

function isRelativeSpecifier(specifier: string): boolean {
    return specifier.startsWith('./') || specifier.startsWith('../');
}

function findVirtualFile(candidate: string, files: VirtualFsFileMap): string | undefined {
    const normalizedCandidate = normalizeVirtualPath(candidate);

    for (const filePath of Object.keys(files)) {
        if (normalizeVirtualPath(filePath) === normalizedCandidate) {
            return normalizedCandidate;
        }
    }

    return undefined;
}

function buildProbeCandidates(basePath: string): string[] {
    const candidates: string[] = [];
    const seen = new Set<string>();

    for (const extension of PROBED_EXTENSIONS) {
        addCandidate(candidates, seen, `${basePath}${extension}`);
    }

    const indexBase = `${basePath}/index`;
    for (const extension of PROBED_EXTENSIONS) {
        addCandidate(candidates, seen, `${indexBase}${extension}`);
    }

    return candidates;
}

function addCandidate(candidates: string[], seen: Set<string>, candidate: string): void {
    const normalized = normalizeVirtualPath(candidate);
    if (seen.has(normalized)) {
        return;
    }

    seen.add(normalized);
    candidates.push(normalized);
}

function hasSupportedExtension(path: string): boolean {
    return PROBED_EXTENSIONS.some((extension) => path.endsWith(extension));
}

function joinVirtualPath(baseDir: string, specifier: string): string {
    if (baseDir.length === 0) {
        return specifier;
    }

    return `${baseDir}/${specifier}`;
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
    const trimmed = normalizedSeparators.startsWith('/') ? normalizedSeparators.slice(1) : normalizedSeparators;
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

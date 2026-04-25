import type { VirtualFsFileMap } from './virtual-fs-resolve';

const CODE_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx'] as const;

const ASSET_EXTENSIONS = [
    '.avif',
    '.bmp',
    '.cur',
    '.eot',
    '.flac',
    '.gif',
    '.ico',
    '.jpeg',
    '.jpg',
    '.m4a',
    '.mp3',
    '.mp4',
    '.otf',
    '.pdf',
    '.png',
    '.svg',
    '.ttf',
    '.wav',
    '.webm',
    '.webp',
    '.woff',
    '.woff2',
    '.zip',
] as const;

export interface VirtualFsLoadArgs {
    path: string;
    namespace?: string;
}

export interface VirtualFsLoadResult {
    contents: string;
    loader: 'js' | 'jsx' | 'ts' | 'tsx' | 'json';
}

export interface VirtualFsLoadBuild {
    onLoad(
        options: { filter: RegExp; namespace?: string },
        callback: (args: VirtualFsLoadArgs) => VirtualFsLoadResult | Promise<VirtualFsLoadResult>,
    ): void;
}

export interface VirtualFsLoadPlugin {
    name: string;
    setup(build: VirtualFsLoadBuild): void;
}

export interface CreateVirtualFsLoadPluginOptions {
    files: VirtualFsFileMap;
    namespace?: string;
}

export function createVirtualFsLoadPlugin(options: CreateVirtualFsLoadPluginOptions): VirtualFsLoadPlugin {
    return {
        name: 'virtual-fs-load',
        setup(build) {
            build.onLoad(
                { filter: /.*/, namespace: options.namespace },
                (args) => loadVirtualFsFile(args.path, options.files),
            );
        },
    };
}

export function loadVirtualFsFile(path: string, files: VirtualFsFileMap): VirtualFsLoadResult {
    const filePath = findVirtualFile(path, files);

    if (filePath === undefined) {
        throw new Error(`Unable to load virtual file "${path}"`);
    }

    const contents = files[filePath];
    if (contents === undefined) {
        throw new Error(`Unable to load virtual file "${path}"`);
    }
    const extension = getVirtualFileExtension(filePath);

    if (isCodeExtension(extension)) {
        return {
            contents,
            loader: inferCodeLoader(extension),
        };
    }

    if (extension === '.json') {
        return {
            contents,
            loader: 'json',
        };
    }

    if (isAssetExtension(extension)) {
        return {
            contents: createAssetModuleSource(filePath, contents),
            loader: 'js',
        };
    }

    return {
        contents,
        loader: 'js',
    };
}

export function inferVirtualFsLoader(path: string): VirtualFsLoadResult['loader'] {
    const extension = getVirtualFileExtension(path);

    if (isCodeExtension(extension)) {
        return inferCodeLoader(extension);
    }

    if (extension === '.json') {
        return 'json';
    }

    return 'js';
}

function findVirtualFile(candidate: string, files: VirtualFsFileMap): string | undefined {
    const normalizedCandidate = normalizeVirtualPath(candidate);

    for (const filePath of Object.keys(files)) {
        if (normalizeVirtualPath(filePath) === normalizedCandidate) {
            return filePath;
        }
    }

    return undefined;
}

function getVirtualFileExtension(path: string): string {
    const normalizedPath = normalizeVirtualPath(path);
    const lastSlash = normalizedPath.lastIndexOf('/');
    const fileName = lastSlash === -1 ? normalizedPath : normalizedPath.slice(lastSlash + 1);
    const lastDot = fileName.lastIndexOf('.');

    if (lastDot === -1) {
        return '';
    }

    return fileName.slice(lastDot).toLowerCase();
}

function isCodeExtension(extension: string): extension is (typeof CODE_EXTENSIONS)[number] {
    return CODE_EXTENSIONS.includes(extension as (typeof CODE_EXTENSIONS)[number]);
}

function inferCodeLoader(extension: (typeof CODE_EXTENSIONS)[number]): VirtualFsLoadResult['loader'] {
    switch (extension) {
        case '.ts':
            return 'ts';
        case '.tsx':
            return 'tsx';
        case '.jsx':
            return 'jsx';
        case '.js':
        default:
            return 'js';
    }
}

function isAssetExtension(extension: string): extension is (typeof ASSET_EXTENSIONS)[number] {
    return ASSET_EXTENSIONS.includes(extension as (typeof ASSET_EXTENSIONS)[number]);
}

function createAssetModuleSource(filePath: string, contents: string): string {
    const extension = getVirtualFileExtension(filePath);
    const mimeType = getAssetMimeType(extension);
    const base64 = Buffer.from(contents, 'utf8').toString('base64');

    return `export default ${JSON.stringify(`data:${mimeType};base64,${base64}`)};`;
}

function getAssetMimeType(extension: string): string {
    switch (extension) {
        case '.avif':
            return 'image/avif';
        case '.bmp':
            return 'image/bmp';
        case '.cur':
        case '.ico':
            return 'image/x-icon';
        case '.eot':
            return 'application/vnd.ms-fontobject';
        case '.flac':
            return 'audio/flac';
        case '.gif':
            return 'image/gif';
        case '.jpeg':
        case '.jpg':
            return 'image/jpeg';
        case '.m4a':
            return 'audio/mp4';
        case '.mp3':
            return 'audio/mpeg';
        case '.mp4':
            return 'video/mp4';
        case '.otf':
            return 'font/otf';
        case '.pdf':
            return 'application/pdf';
        case '.png':
            return 'image/png';
        case '.svg':
            return 'image/svg+xml';
        case '.ttf':
            return 'font/ttf';
        case '.wav':
            return 'audio/wav';
        case '.webm':
            return 'video/webm';
        case '.webp':
            return 'image/webp';
        case '.woff':
            return 'font/woff';
        case '.woff2':
            return 'font/woff2';
        case '.zip':
            return 'application/zip';
        default:
            return 'application/octet-stream';
    }
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

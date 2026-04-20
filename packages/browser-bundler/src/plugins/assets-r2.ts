import { createHash } from 'node:crypto';

export type R2AssetContents = string | Uint8Array | ArrayBufferView;

export type R2AssetFileMap = Readonly<Record<string, R2AssetContents>>;

export interface EsbuildLoadArgs {
    readonly path: string;
    readonly namespace?: string;
}

export interface EsbuildLoadResult {
    readonly contents?: string;
    readonly loader?: 'js';
    readonly resolveDir?: string;
    readonly errors?: readonly { text: string }[];
}

export interface EsbuildLoadBuild {
    onLoad(
        options: { filter: RegExp; namespace?: string },
        callback: (args: EsbuildLoadArgs) => EsbuildLoadResult | undefined | void,
    ): void;
}

export interface EsbuildLoadPlugin {
    readonly name: string;
    setup(build: EsbuildLoadBuild): void;
}

export interface CreateAssetsR2PluginOptions {
    readonly files: R2AssetFileMap;
    readonly baseAssetUrl: string | URL;
    readonly maxInlineBytes?: number;
    readonly assetKey?: (options: { readonly path: string; readonly contents: Uint8Array }) => string;
    readonly namespace?: string;
}

const DEFAULT_MAX_INLINE_BYTES = 8 * 1024;

const ASSET_FILTER = /\.(?:avif|bmp|gif|ico|jpeg|jpg|otf|png|svg|ttf|webp|woff|woff2)$/i;

const textEncoder = new TextEncoder();

export function createAssetsR2Plugin(
    options: CreateAssetsR2PluginOptions,
): EsbuildLoadPlugin {
    const maxInlineBytes = options.maxInlineBytes ?? DEFAULT_MAX_INLINE_BYTES;
    const baseAssetUrl = normalizeBaseAssetUrl(options.baseAssetUrl);
    const assetKey = options.assetKey ?? defaultAssetKey;

    return {
        name: 'assets-r2',
        setup(build) {
            build.onLoad({ filter: ASSET_FILTER, namespace: options.namespace }, (args) => {
                const contents = options.files[normalizeAssetPath(args.path)];

                if (contents === undefined) {
                    return undefined;
                }

                return createR2AssetModule({
                    contents,
                    path: args.path,
                    baseAssetUrl,
                    maxInlineBytes,
                    assetKey,
                });
            });
        },
    };
}

export function createR2AssetModule(options: {
    contents: R2AssetContents;
    path: string;
    baseAssetUrl: string | URL;
    maxInlineBytes: number;
    assetKey: (options: { readonly path: string; readonly contents: Uint8Array }) => string;
}): EsbuildLoadResult | undefined {
    if (!isAssetPath(options.path)) {
        return undefined;
    }

    const bytes = toUint8Array(options.contents);

    if (bytes.byteLength <= options.maxInlineBytes) {
        return undefined;
    }

    const key = options.assetKey({
        path: normalizeAssetPath(options.path),
        contents: bytes,
    });

    const url = createImmutableAssetUrl(options.baseAssetUrl, key);

    return {
        contents: `export default ${JSON.stringify(url)};`,
        loader: 'js',
    };
}

export function createImmutableAssetUrl(baseAssetUrl: string | URL, key: string): string {
    const base = normalizeBaseAssetUrl(baseAssetUrl);
    const encodedKey = encodeAssetKeyPath(key);
    return new URL(encodedKey, base).toString();
}

export function defaultAssetKey(options: {
    readonly path: string;
    readonly contents: Uint8Array;
}): string {
    const hash = createHash('sha256');
    hash.update(options.path);
    hash.update('\0');
    hash.update(options.contents);
    return hash.digest('hex');
}

function normalizeBaseAssetUrl(baseAssetUrl: string | URL): URL {
    const base = new URL(baseAssetUrl.toString());

    if (!base.pathname.endsWith('/')) {
        base.pathname = `${base.pathname}/`;
    }

    return base;
}

function encodeAssetKeyPath(key: string): string {
    return normalizeAssetPath(key)
        .split('/')
        .map((segment) => encodeURIComponent(segment))
        .join('/');
}

function normalizeAssetPath(path: string): string {
    return path.replace(/\\/g, '/').replace(/^\/+/, '');
}

function isAssetPath(path: string): boolean {
    return ASSET_FILTER.test(normalizeAssetPath(path));
}

function toUint8Array(contents: R2AssetContents): Uint8Array {
    if (typeof contents === 'string') {
        return textEncoder.encode(contents);
    }

    if (contents instanceof Uint8Array) {
        return contents;
    }

    return new Uint8Array(contents.buffer, contents.byteOffset, contents.byteLength);
}

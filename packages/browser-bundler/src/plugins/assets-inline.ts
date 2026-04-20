export type InlineAssetContents = string | Uint8Array | ArrayBufferView;

export type InlineAssetFileMap = Readonly<Record<string, InlineAssetContents>>;

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

export interface CreateAssetsInlinePluginOptions {
    readonly files: InlineAssetFileMap;
    readonly maxInlineBytes?: number;
    readonly namespace?: string;
}

const DEFAULT_MAX_INLINE_BYTES = 8 * 1024;

const ASSET_MIME_TYPES: Readonly<Record<string, string>> = {
    '.avif': 'image/avif',
    '.bmp': 'image/bmp',
    '.gif': 'image/gif',
    '.ico': 'image/x-icon',
    '.jpeg': 'image/jpeg',
    '.jpg': 'image/jpeg',
    '.otf': 'font/otf',
    '.png': 'image/png',
    '.svg': 'image/svg+xml',
    '.ttf': 'font/ttf',
    '.webp': 'image/webp',
    '.woff': 'font/woff',
    '.woff2': 'font/woff2',
};

const ASSET_FILTER = /\.(?:avif|bmp|gif|ico|jpeg|jpg|otf|png|svg|ttf|webp|woff|woff2)$/i;

const textEncoder = new TextEncoder();

export function createAssetsInlinePlugin(
    options: CreateAssetsInlinePluginOptions,
): EsbuildLoadPlugin {
    const maxInlineBytes = options.maxInlineBytes ?? DEFAULT_MAX_INLINE_BYTES;

    return {
        name: 'assets-inline',
        setup(build) {
            build.onLoad({ filter: ASSET_FILTER, namespace: options.namespace }, (args) => {
                const contents = options.files[normalizeAssetPath(args.path)];

                if (contents === undefined) {
                    return undefined;
                }

                return createInlineAssetModule({
                    contents,
                    path: args.path,
                    maxInlineBytes,
                });
            });
        },
    };
}

export function createInlineAssetModule(options: {
    contents: InlineAssetContents;
    path: string;
    maxInlineBytes: number;
}): EsbuildLoadResult | undefined {
    const mimeType = inferAssetMimeType(options.path);
    if (mimeType === undefined) {
        return undefined;
    }

    const bytes = toUint8Array(options.contents);
    if (bytes.byteLength > options.maxInlineBytes) {
        return undefined;
    }

    const dataUrl = `data:${mimeType};base64,${base64Encode(bytes)}`;
    return {
        contents: `export default ${JSON.stringify(dataUrl)};`,
        loader: 'js',
    };
}

export function inferAssetMimeType(path: string): string | undefined {
    const extension = getAssetExtension(path);

    if (extension === undefined) {
        return undefined;
    }

    return ASSET_MIME_TYPES[extension];
}

function getAssetExtension(path: string): string | undefined {
    const normalized = normalizeAssetPath(path);
    const dotIndex = normalized.lastIndexOf('.');

    if (dotIndex === -1) {
        return undefined;
    }

    return normalized.slice(dotIndex).toLowerCase();
}

function normalizeAssetPath(path: string): string {
    return path.replace(/\\/g, '/').replace(/^\/+/, '');
}

function toUint8Array(contents: InlineAssetContents): Uint8Array {
    if (typeof contents === 'string') {
        return textEncoder.encode(contents);
    }

    if (contents instanceof Uint8Array) {
        return contents;
    }

    return new Uint8Array(contents.buffer, contents.byteOffset, contents.byteLength);
}

function base64Encode(bytes: Uint8Array): string {
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
    let output = '';

    for (let index = 0; index < bytes.length; index += 3) {
        const first = bytes[index] ?? 0;
        const second = bytes[index + 1];
        const third = bytes[index + 2];

        const chunk = (first << 16) | ((second ?? 0) << 8) | (third ?? 0);

        output += alphabet[(chunk >> 18) & 63];
        output += alphabet[(chunk >> 12) & 63];
        output += second === undefined ? '=' : alphabet[(chunk >> 6) & 63];
        output += third === undefined ? '=' : alphabet[chunk & 63];
    }

    return output;
}

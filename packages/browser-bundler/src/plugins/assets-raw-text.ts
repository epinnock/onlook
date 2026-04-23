/**
 * assets-raw-text plugin — implements Phase 7 task #61 (raw-text imports for
 * `.txt`, `.md`, `.html`, `.glsl`, `.frag`, `.vert`) and partially #57 (SVG as
 * raw text via `?raw` query — see `?raw` handling below).
 *
 * Mirrors the shape of `assets-inline.ts` and `assets-r2.ts`: esbuild onLoad
 * handler that reads from a virtual file map and returns a JS module whose
 * default export is the file's contents as a string. Keeps the plugin
 * container-free (no dependency on `esbuild` types at this layer) so unit
 * tests can drive it without loading esbuild-wasm.
 */

export type RawTextAssetContents = string | Uint8Array | ArrayBufferView;

export type RawTextAssetFileMap = Readonly<Record<string, RawTextAssetContents>>;

export interface EsbuildLoadArgs {
    readonly path: string;
    readonly namespace?: string;
    readonly suffix?: string;
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

export interface CreateAssetsRawTextPluginOptions {
    readonly files: RawTextAssetFileMap;
    readonly namespace?: string;
    /**
     * Extensions to treat as raw-text by default (without a `?raw` query).
     * Pass an empty array to force every raw-text import to go through
     * an explicit `?raw` suffix.
     */
    readonly textExtensions?: readonly string[];
}

const DEFAULT_TEXT_EXTENSIONS = [
    '.txt',
    '.md',
    '.markdown',
    '.html',
    '.htm',
    '.glsl',
    '.frag',
    '.vert',
    '.csv',
    '.tsv',
];

// Matches every extension we might care about — the plugin narrows per-call.
// `?raw` is intentionally OUTSIDE the character class so it appears as a
// literal suffix when present.
const RAW_TEXT_FILTER =
    /\.(?:txt|md|markdown|html|htm|glsl|frag|vert|csv|tsv|svg|json|xml)(?:\?raw)?$/i;

const textDecoder = new TextDecoder('utf-8');

export function createAssetsRawTextPlugin(
    options: CreateAssetsRawTextPluginOptions,
): EsbuildLoadPlugin {
    const textExtensions = (options.textExtensions ?? DEFAULT_TEXT_EXTENSIONS).map(
        (ext) => ext.toLowerCase(),
    );

    return {
        name: 'assets-raw-text',
        setup(build) {
            build.onLoad({ filter: RAW_TEXT_FILTER, namespace: options.namespace }, (args) => {
                return loadRawTextAsset({
                    files: options.files,
                    textExtensions,
                    path: args.path,
                    suffix: args.suffix,
                });
            });
        },
    };
}

export function loadRawTextAsset(input: {
    readonly files: RawTextAssetFileMap;
    readonly textExtensions: readonly string[];
    readonly path: string;
    readonly suffix?: string;
}): EsbuildLoadResult | undefined {
    const { pathWithoutQuery, hasRawQuery } = parseRawTextSpecifier(input.path);
    const hasSuffixRaw = (input.suffix ?? '') === '?raw';
    const extension = getExtension(pathWithoutQuery);

    if (extension === undefined) {
        return undefined;
    }

    const extensionAllowed = input.textExtensions.includes(extension);
    if (!(extensionAllowed || hasRawQuery || hasSuffixRaw)) {
        return undefined;
    }

    const contents =
        input.files[normalizeAssetPath(pathWithoutQuery)] ??
        input.files[normalizeAssetPath(input.path)];

    if (contents === undefined) {
        return undefined;
    }

    const text = toText(contents);
    return {
        contents: `export default ${JSON.stringify(text)};`,
        loader: 'js',
    };
}

export function parseRawTextSpecifier(specifier: string): {
    readonly pathWithoutQuery: string;
    readonly hasRawQuery: boolean;
} {
    const qIndex = specifier.indexOf('?');
    if (qIndex === -1) {
        return { pathWithoutQuery: specifier, hasRawQuery: false };
    }
    const query = specifier.slice(qIndex);
    // Match ?raw or ?raw&... or ?...&raw
    const hasRawQuery = /(?:^|[?&])raw(?:$|&|=)/.test(query);
    return {
        pathWithoutQuery: specifier.slice(0, qIndex),
        hasRawQuery,
    };
}

function getExtension(path: string): string | undefined {
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

function toText(contents: RawTextAssetContents): string {
    if (typeof contents === 'string') {
        return contents;
    }
    if (contents instanceof Uint8Array) {
        return textDecoder.decode(contents);
    }
    return textDecoder.decode(
        new Uint8Array(contents.buffer, contents.byteOffset, contents.byteLength),
    );
}

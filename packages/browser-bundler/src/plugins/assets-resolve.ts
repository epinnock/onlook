import { createHash } from 'node:crypto';

/**
 * assets-resolve plugin — task #66 of two-tier-overlay-v2.
 *
 * Emits asset stub modules whose default export routes through the runtime's
 * `OnlookRuntime.resolveAsset(assetId)` API instead of exporting a raw URL.
 * Pairs with an accompanying `OverlayAssetManifest` that the editor ships
 * alongside the overlay bundle via `mountOverlay(source, props, assets)`:
 *
 *   // Bundler output (per asset import):
 *   export default (globalThis.OnlookRuntime?.resolveAsset
 *     ? globalThis.OnlookRuntime.resolveAsset("<assetId>")
 *     : null);
 *
 *   // Manifest (alongside the bundle):
 *   { abi: 'v1', assets: { "<assetId>": { kind: 'image', hash: '...', uri: '...', ... } } }
 *
 * The caller provides a `register(assetId, descriptor)` sink. Usually that's
 * an `OverlayAssetManifestBuilder` from `createOverlayAssetManifestBuilder()`
 * but any compatible shape works.
 *
 * Descriptor `kind` is inferred from the file extension; callers can override
 * via `kindRouter`. The `uri` field on image/font/svg/media/binary descriptors
 * is produced by `urlForKey` — callers typically pass the same function
 * they'd use for `assets-r2`'s `createImmutableAssetUrl` composition so the
 * manifest URLs match the R2 bucket layout.
 *
 * This plugin does NOT handle inline-small-image heuristics. Callers compose
 * it with `createAssetsInlinePlugin` ahead of it in the plugin chain if they
 * want sub-threshold inlining to take precedence.
 */

export type ResolveAssetContents = string | Uint8Array | ArrayBufferView;

export type ResolveAssetFileMap = Readonly<Record<string, ResolveAssetContents>>;

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

export type AssetDescriptorKind =
    | 'image'
    | 'font'
    | 'svg'
    | 'media'
    | 'json'
    | 'text'
    | 'binary';

export interface ImageAssetDescriptor {
    readonly kind: 'image';
    readonly hash: string;
    readonly mime: string;
    readonly uri: string;
    readonly width?: number;
    readonly height?: number;
    readonly scale?: number;
}

export interface FontAssetDescriptor {
    readonly kind: 'font';
    readonly hash: string;
    readonly mime: string;
    readonly family: string;
    readonly uri: string;
    readonly weight?: number;
    readonly style?: 'normal' | 'italic';
}

export interface SvgAssetDescriptor {
    readonly kind: 'svg';
    readonly hash: string;
    readonly mime: 'image/svg+xml';
    readonly uri: string;
    readonly viewBox?: string;
}

export interface MediaAssetDescriptor {
    readonly kind: 'media';
    readonly hash: string;
    readonly mime: string;
    readonly uri: string;
}

export interface JsonAssetDescriptor {
    readonly kind: 'json';
    readonly hash: string;
    readonly value: unknown;
}

export interface TextAssetDescriptor {
    readonly kind: 'text';
    readonly hash: string;
    readonly value: string;
}

export interface BinaryAssetDescriptor {
    readonly kind: 'binary';
    readonly hash: string;
    readonly mime: string;
    readonly uri: string;
}

export type AssetDescriptor =
    | ImageAssetDescriptor
    | FontAssetDescriptor
    | SvgAssetDescriptor
    | MediaAssetDescriptor
    | JsonAssetDescriptor
    | TextAssetDescriptor
    | BinaryAssetDescriptor;

export interface AssetManifestSink {
    register(assetId: string, descriptor: AssetDescriptor): void;
}

export interface CreateAssetsResolvePluginOptions {
    readonly files: ResolveAssetFileMap;
    readonly manifest: AssetManifestSink;
    /**
     * Given the normalized asset path, return the `uri` field for the
     * descriptor. Typical implementation mirrors assets-r2's
     * `createImmutableAssetUrl(baseUrl, defaultAssetKey({path, contents}))`.
     */
    readonly urlForKey: (input: {
        readonly path: string;
        readonly hash: string;
        readonly contents: Uint8Array;
    }) => string;
    readonly namespace?: string;
    /**
     * Optional override — given the path, returns the kind to emit. Defaults
     * to the extension-based routing in `routeAssetKind`.
     */
    readonly kindRouter?: (path: string) => AssetDescriptorKind | undefined;
    /**
     * Mapping of file extension → MIME type. Plugin falls back to
     * `DEFAULT_ASSET_MIME_TYPES` when omitted.
     */
    readonly mimeTypes?: Readonly<Record<string, string>>;
}

export const DEFAULT_ASSET_MIME_TYPES: Readonly<Record<string, string>> = {
    // images
    '.avif': 'image/avif',
    '.bmp': 'image/bmp',
    '.gif': 'image/gif',
    '.ico': 'image/x-icon',
    '.jpeg': 'image/jpeg',
    '.jpg': 'image/jpeg',
    '.png': 'image/png',
    '.webp': 'image/webp',
    // fonts
    '.otf': 'font/otf',
    '.ttf': 'font/ttf',
    '.woff': 'font/woff',
    '.woff2': 'font/woff2',
    // svg
    '.svg': 'image/svg+xml',
    // media
    '.mp3': 'audio/mpeg',
    '.wav': 'audio/wav',
    '.m4a': 'audio/mp4',
    '.aac': 'audio/aac',
    '.ogg': 'audio/ogg',
    '.flac': 'audio/flac',
    '.mp4': 'video/mp4',
    '.m4v': 'video/mp4',
    '.mov': 'video/quicktime',
    '.webm': 'video/webm',
    // structured
    '.json': 'application/json',
};

const ASSET_FILTER =
    /\.(?:avif|bmp|gif|ico|jpeg|jpg|otf|png|svg|ttf|webp|woff|woff2|mp3|wav|m4a|aac|ogg|flac|mp4|mov|webm|m4v|json)$/i;

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder('utf-8');

export function createAssetsResolvePlugin(
    options: CreateAssetsResolvePluginOptions,
): EsbuildLoadPlugin {
    const kindRouter = options.kindRouter ?? routeAssetKind;
    const mimeTypes = options.mimeTypes ?? DEFAULT_ASSET_MIME_TYPES;

    return {
        name: 'assets-resolve',
        setup(build) {
            build.onLoad({ filter: ASSET_FILTER, namespace: options.namespace }, (args) => {
                const normalized = normalizeAssetPath(args.path);
                const contents = options.files[normalized] ?? options.files[args.path];
                if (contents === undefined) {
                    return undefined;
                }

                const bytes = toUint8Array(contents);
                const kind = kindRouter(normalized);
                if (kind === undefined) {
                    return undefined;
                }

                const hash = sha256Hex(bytes);
                const assetId = `${kind}/${hash}`;
                const mime = mimeTypes[getExtension(normalized) ?? ''];

                const descriptor = buildDescriptor({
                    kind,
                    hash,
                    bytes,
                    path: normalized,
                    mime,
                    urlForKey: options.urlForKey,
                });

                if (descriptor === undefined) {
                    return undefined;
                }

                options.manifest.register(assetId, descriptor);
                return {
                    contents: buildStubModule(assetId),
                    loader: 'js',
                };
            });
        },
    };
}

export function routeAssetKind(path: string): AssetDescriptorKind | undefined {
    const ext = getExtension(path);
    if (ext === undefined) return undefined;
    switch (ext) {
        case '.png':
        case '.jpg':
        case '.jpeg':
        case '.webp':
        case '.gif':
        case '.avif':
        case '.bmp':
        case '.ico':
            return 'image';
        case '.ttf':
        case '.otf':
        case '.woff':
        case '.woff2':
            return 'font';
        case '.svg':
            return 'svg';
        case '.mp3':
        case '.wav':
        case '.m4a':
        case '.aac':
        case '.ogg':
        case '.flac':
        case '.mp4':
        case '.m4v':
        case '.mov':
        case '.webm':
            return 'media';
        case '.json':
            return 'json';
        default:
            return 'binary';
    }
}

export function buildStubModule(assetId: string): string {
    return (
        `export default (globalThis.OnlookRuntime && typeof globalThis.OnlookRuntime.resolveAsset === "function" ` +
        `? globalThis.OnlookRuntime.resolveAsset(${JSON.stringify(assetId)}) ` +
        `: null);`
    );
}

function buildDescriptor(input: {
    readonly kind: AssetDescriptorKind;
    readonly hash: string;
    readonly bytes: Uint8Array;
    readonly path: string;
    readonly mime: string | undefined;
    readonly urlForKey: CreateAssetsResolvePluginOptions['urlForKey'];
}): AssetDescriptor | undefined {
    switch (input.kind) {
        case 'image': {
            if (input.mime === undefined) return undefined;
            return {
                kind: 'image',
                hash: input.hash,
                mime: input.mime,
                uri: input.urlForKey({ path: input.path, hash: input.hash, contents: input.bytes }),
            };
        }
        case 'font': {
            if (input.mime === undefined) return undefined;
            return {
                kind: 'font',
                hash: input.hash,
                mime: input.mime,
                family: deriveFontFamily(input.path),
                uri: input.urlForKey({ path: input.path, hash: input.hash, contents: input.bytes }),
            };
        }
        case 'svg':
            return {
                kind: 'svg',
                hash: input.hash,
                mime: 'image/svg+xml',
                uri: input.urlForKey({ path: input.path, hash: input.hash, contents: input.bytes }),
                viewBox: extractSvgViewBox(textDecoder.decode(input.bytes)),
            };
        case 'media': {
            if (input.mime === undefined) return undefined;
            return {
                kind: 'media',
                hash: input.hash,
                mime: input.mime,
                uri: input.urlForKey({ path: input.path, hash: input.hash, contents: input.bytes }),
            };
        }
        case 'json': {
            try {
                return {
                    kind: 'json',
                    hash: input.hash,
                    value: JSON.parse(textDecoder.decode(input.bytes)),
                };
            } catch {
                return undefined;
            }
        }
        case 'text':
            return {
                kind: 'text',
                hash: input.hash,
                value: textDecoder.decode(input.bytes),
            };
        case 'binary': {
            // binary needs a MIME type; if unknown, fall back to octet-stream.
            const mime = input.mime ?? 'application/octet-stream';
            return {
                kind: 'binary',
                hash: input.hash,
                mime,
                uri: input.urlForKey({ path: input.path, hash: input.hash, contents: input.bytes }),
            };
        }
    }
}

export function extractSvgViewBox(svg: string): string | undefined {
    const match = /viewBox=["']([^"']+)["']/i.exec(svg);
    return match?.[1];
}

export function deriveFontFamily(path: string): string {
    // Strip directory + extension, leave the base name. Fancy font-metadata
    // introspection lives behind `#63 font hints` — this default is enough to
    // make `loadFont(family, ...)` look reasonable without opening the file.
    const normalized = normalizeAssetPath(path);
    const slash = normalized.lastIndexOf('/');
    const base = slash === -1 ? normalized : normalized.slice(slash + 1);
    const dot = base.lastIndexOf('.');
    return (dot === -1 ? base : base.slice(0, dot)) || 'asset';
}

export function sha256Hex(bytes: Uint8Array): string {
    const h = createHash('sha256');
    h.update(bytes);
    return h.digest('hex');
}

function getExtension(path: string): string | undefined {
    const normalized = normalizeAssetPath(path);
    const dotIndex = normalized.lastIndexOf('.');
    if (dotIndex === -1) return undefined;
    return normalized.slice(dotIndex).toLowerCase();
}

function normalizeAssetPath(path: string): string {
    return path.replace(/\\/g, '/').replace(/^\/+/, '');
}

function toUint8Array(contents: ResolveAssetContents): Uint8Array {
    if (typeof contents === 'string') {
        return textEncoder.encode(contents);
    }
    if (contents instanceof Uint8Array) {
        return contents;
    }
    return new Uint8Array(contents.buffer, contents.byteOffset, contents.byteLength);
}

// ─── Manifest builder ────────────────────────────────────────────────────────

export interface OverlayAssetManifestBuilder extends AssetManifestSink {
    build(): { abi: 'v1'; assets: Readonly<Record<string, AssetDescriptor>> };
    readonly size: number;
}

/**
 * In-memory manifest accumulator. Callers feed it to the plugin as `manifest:`
 * and drain via `build()` after the bundler finishes. Output shape matches
 * the `OverlayAssetManifestSchema` in `@onlook/mobile-client-protocol` modulo
 * the abi literal (the builder emits 'v1' always; callers that need a
 * different ABI can wrap this and substitute).
 */
export function createOverlayAssetManifestBuilder(): OverlayAssetManifestBuilder {
    const assets: Record<string, AssetDescriptor> = {};
    return {
        register(assetId, descriptor) {
            // Last write wins — same content → same hash → same assetId → same
            // descriptor (idempotent). Different descriptors for the same id
            // is a caller error and indicates a hash collision or id scheme
            // drift; we don't guard against it here.
            assets[assetId] = descriptor;
        },
        build() {
            return { abi: 'v1', assets };
        },
        get size() {
            return Object.keys(assets).length;
        },
    };
}

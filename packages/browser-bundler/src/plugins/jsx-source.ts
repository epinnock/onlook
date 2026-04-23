/**
 * __source metadata injection — task #84 / Phase 10 stub.
 *
 * Tap-to-source (onlook:tap → editor jumps to file:line:col) needs every
 * JSX element in overlay output to carry `__source={{fileName, lineNumber,
 * columnNumber}}`. Babel's `transform-react-jsx-source` does this in the
 * standard RN pipeline; we need an esbuild plugin equivalent for the
 * overlay bundling path.
 *
 * This module is the plugin contract + a pure-function injector. The full
 * esbuild onLoad integration is a follow-up — today's implementation:
 *   1. Exposes `createJsxSourcePlugin(options)` returning an esbuild plugin
 *      shape that can be wired into the overlay builder.
 *   2. Exposes `injectJsxSource(source, filename)` that applies the
 *      transformation to a pre-parsed source string (text-level regex
 *      implementation — replaced with a proper AST pass later).
 *
 * The regex implementation is deliberately conservative: it only augments
 * JSX opening tags that DON'T already have a `__source` attribute. JSX
 * fragments (`<></>`) and already-instrumented elements pass through
 * unchanged.
 */

export interface JsxSourceInjectorOptions {
    /** Source file path, used to populate `__source.fileName`. */
    readonly filename: string;
    /**
     * When true, ONLY inject __source on opening tags that don't already
     * have one. Default true. Set false to force re-injection.
     */
    readonly skipExisting?: boolean;
}

export type JsxSourceContents = string | Uint8Array | ArrayBufferView;

export type JsxSourceFileMap = Readonly<Record<string, JsxSourceContents>>;

export interface EsbuildLoadArgs {
    readonly path: string;
    readonly namespace?: string;
    readonly suffix?: string;
}

export interface EsbuildLoadResult {
    readonly contents: string;
    readonly loader: 'tsx' | 'jsx';
    readonly resolveDir?: string;
}

export interface EsbuildLoadBuild {
    onLoad(
        options: { filter: RegExp; namespace?: string },
        callback: (args: EsbuildLoadArgs) => EsbuildLoadResult | undefined | void,
    ): void;
}

export interface EsbuildPluginShape {
    readonly name: string;
    setup(build: EsbuildLoadBuild): void;
}

/**
 * Transform a source string, injecting `__source` into JSX opening tags.
 * Conservative regex implementation — covers the common case of
 * `<Component prop="x">` without attempting to correctly handle:
 *   - self-closing tags (handled)
 *   - JSX fragments (`<>` — skipped)
 *   - nested braces in existing props (may confuse the regex)
 *
 * For the overlay preview path this is sufficient; a full AST-level
 * implementation is tracked as follow-up.
 */
export function injectJsxSource(
    source: string,
    options: JsxSourceInjectorOptions,
): string {
    const skipExisting = options.skipExisting ?? true;
    // Regex: `<Identifier` then optional attributes (not consuming `/` or `>`),
    // then optional `/` for self-close, then `>`.
    const OPENING_TAG_RE = /<([A-Z][A-Za-z0-9_$]*|[a-z][A-Za-z0-9_$-]*)((?:\s[^/>]*)?)(\s*\/)?>/g;
    return source.replace(OPENING_TAG_RE, (match, tag: string, attrs: string | undefined, selfClose: string | undefined, offset: number) => {
        const attrStr = attrs ?? '';
        if (skipExisting && /\b__source\b/.test(attrStr)) {
            return match;
        }
        const { line, column } = resolveLineColumn(source, offset);
        const sourceAttr = ` __source={{fileName: ${JSON.stringify(options.filename)}, lineNumber: ${line}, columnNumber: ${column}}}`;
        return `<${tag}${attrStr}${sourceAttr}${selfClose ?? ''}>`;
    });
}

export interface CreateJsxSourcePluginOptions {
    readonly filter?: RegExp;
    /**
     * Virtual file map of TSX/JSX sources keyed by path. When provided, the
     * plugin reads contents from this map, applies `injectJsxSource`, and
     * returns the transformed output. When omitted, the plugin returns
     * `undefined` so a downstream loader (usually the virtual-fs-load
     * plugin) can claim the file.
     */
    readonly files?: JsxSourceFileMap;
    /**
     * Override the filename used in injected `__source.fileName` props.
     * Defaults to the esbuild-reported path.
     */
    readonly filenameFor?: (path: string) => string;
    readonly namespace?: string;
}

export function createJsxSourcePlugin(
    options: CreateJsxSourcePluginOptions = {},
): EsbuildPluginShape {
    const filter = options.filter ?? /\.(tsx|jsx)$/;
    return {
        name: 'onlook-jsx-source',
        setup(build) {
            build.onLoad({ filter, namespace: options.namespace }, (args) => {
                if (options.files === undefined) {
                    return undefined;
                }
                const normalized = normalizeJsxPath(args.path);
                const raw = options.files[normalized] ?? options.files[args.path];
                if (raw === undefined) {
                    return undefined;
                }
                const source = toText(raw);
                const filename = options.filenameFor
                    ? options.filenameFor(args.path)
                    : args.path;
                const transformed = injectJsxSource(source, { filename });
                return {
                    contents: transformed,
                    loader: args.path.endsWith('.tsx') ? 'tsx' : 'jsx',
                };
            });
        },
    };
}

const textDecoder = new TextDecoder('utf-8');

function toText(contents: JsxSourceContents): string {
    if (typeof contents === 'string') return contents;
    if (contents instanceof Uint8Array) return textDecoder.decode(contents);
    return textDecoder.decode(
        new Uint8Array(contents.buffer, contents.byteOffset, contents.byteLength),
    );
}

function normalizeJsxPath(path: string): string {
    return path.replace(/\\/g, '/').replace(/^\/+/, '');
}

function resolveLineColumn(source: string, offset: number): { line: number; column: number } {
    let line = 1;
    let column = 0;
    for (let i = 0; i < offset && i < source.length; i += 1) {
        if (source[i] === '\n') {
            line += 1;
            column = 0;
        } else {
            column += 1;
        }
    }
    return { line, column };
}

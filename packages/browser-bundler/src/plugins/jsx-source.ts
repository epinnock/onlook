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

export interface EsbuildPluginShape {
    readonly name: string;
    setup(build: { onLoad(filter: { filter: RegExp }, handler: unknown): void }): void;
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

export function createJsxSourcePlugin(options: {
    readonly filter?: RegExp;
}): EsbuildPluginShape {
    const filter = options.filter ?? /\.(tsx|jsx)$/;
    return {
        name: 'onlook-jsx-source',
        setup(build) {
            build.onLoad(
                { filter },
                // The actual esbuild `onLoad` callback takes `{ path, namespace }`
                // and must return `{ contents, loader }`. This stub accepts the
                // handler without calling it — the real wiring ships with the
                // full esbuild integration in Phase 10.
                (() => undefined) as unknown,
            );
        },
    };
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

/**
 * Bare-import rewriter — TR2.3 (Wave R2).
 *
 * Rewrites every bare ESM import in a source string to point at an ESM CDN
 * (e.g. esm.sh or our cf-esm-cache worker). Used by the BrowserMetro host so
 * that the preview iframe can resolve `import 'react'` and friends at runtime
 * without needing a full node_modules graph.
 *
 * A "bare" import is any specifier that:
 *   - does NOT start with '.' (relative)
 *   - does NOT start with '/' (absolute path)
 *   - is NOT an http(s) URL
 *
 * Sub-paths (`lodash/fp`) and scoped packages (`@reach/router`) are preserved
 * verbatim. The rewriter also supports a small alias map so that
 * `react-native` can be redirected to `react-native-web` in the browser
 * preview while still reporting the original name in `bareImports` (which the
 * iframe uses to build its import map).
 */

const DEFAULT_EXTERNAL: readonly string[] = [
    'react',
    'react-dom',
    'react-native',
    'react-native-web',
];

const DEFAULT_ALIASES: Readonly<Record<string, string>> = {
    'react-native': 'react-native-web',
};

/**
 * Matches every static and dynamic ESM import/export form whose specifier
 * lives inside matching quotes. Capture groups:
 *   1: opening quote
 *   2: specifier text (must be followed by the same quote — enforced by \1)
 *
 * Forms covered:
 *   import X from '...'
 *   import { x } from '...'
 *   import * as X from '...'
 *   import X, { y } from '...'
 *   import '...'                          (side-effect)
 *   import('...')                         (dynamic)
 *   export { x } from '...'
 *   export * from '...'
 *   export * as X from '...'
 *
 * The character class [\w*${}\s,] permits the bindings list (default
 * specifier, namespace, named bindings) without having to enumerate every
 * permutation. `from` itself is `\w+` so it falls under `\w`.
 */
const IMPORT_RE =
    /\b(?:import\s*(?:[\w*${}\s,]+\s+from\s*)?|import\s*\(\s*|export\s+(?:[\w*${}\s,]+\s+from\s*|\*\s+from\s*))(['"])([^'"\n]+)\1/g;

export interface RewriteOptions {
    /** Base URL of the ESM CDN (e.g. 'https://esm.sh' or the Cloudflare Worker). */
    esmUrl: string;
    /**
     * Bare specifiers that should be marked external in the esm.sh URL.
     * Default: ['react', 'react-dom', 'react-native', 'react-native-web'].
     * The rewritten URL ends up like:
     *   https://esm.sh/expo-status-bar?bundle&external=react,react-native,react-native-web
     */
    external?: readonly string[];
    /**
     * Map of bare-spec to runtime alias. Used to redirect react-native →
     * react-native-web for in-browser preview.
     * Default: { 'react-native': 'react-native-web' }.
     */
    aliases?: Record<string, string>;
}

export interface RewriteResult {
    /** Rewritten source with bare imports replaced by ESM CDN URLs. */
    code: string;
    /** Set of unique bare specifiers that were rewritten (de-aliased — original names). */
    bareImports: string[];
}

/**
 * Rewrites every bare ESM import in `source` to a CDN URL. Relative,
 * absolute, and http(s) imports are left untouched.
 */
export function rewriteBareImports(source: string, opts: RewriteOptions): RewriteResult {
    const external = opts.external ?? DEFAULT_EXTERNAL;
    const aliases = opts.aliases ?? DEFAULT_ALIASES;
    const baseUrl = stripTrailingSlash(opts.esmUrl);
    const query = buildQuery(external);

    const seen = new Set<string>();
    // Reset lastIndex defensively — IMPORT_RE is module-scoped so a previous
    // call could have left it in a partial-match state.
    IMPORT_RE.lastIndex = 0;

    const code = source.replace(IMPORT_RE, (match, openQuote: string, spec: string) => {
        if (!isBareSpecifier(spec)) {
            return match;
        }
        seen.add(spec);
        const aliased = aliases[spec] ?? spec;
        const rewritten = `${baseUrl}/${aliased}${query}`;
        // Replace just the specifier; preserve everything before/after the
        // opening quote to keep `import X from`, `import(`, etc. intact.
        const quoteIdx = match.lastIndexOf(openQuote + spec + openQuote);
        if (quoteIdx === -1) {
            // Should never happen given the regex, but be defensive.
            return match;
        }
        return (
            match.slice(0, quoteIdx) +
            openQuote +
            rewritten +
            openQuote +
            match.slice(quoteIdx + openQuote.length + spec.length + openQuote.length)
        );
    });

    return {
        code,
        bareImports: Array.from(seen),
    };
}

function isBareSpecifier(spec: string): boolean {
    if (spec.length === 0) return false;
    if (spec.startsWith('.') || spec.startsWith('/')) return false;
    if (/^https?:\/\//i.test(spec)) return false;
    return true;
}

function stripTrailingSlash(url: string): string {
    return url.endsWith('/') ? url.slice(0, -1) : url;
}

function buildQuery(external: readonly string[]): string {
    if (external.length === 0) {
        return '?bundle';
    }
    return `?bundle&external=${external.join(',')}`;
}

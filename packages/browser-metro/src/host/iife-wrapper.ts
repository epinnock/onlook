/**
 * IIFE wrapper for the browser-metro bundle.
 *
 * TR2.4: Takes the bundled module map + entry path and produces a single
 * self-contained JS string the iframe can ship in a <script> tag.
 *
 * The wrapper is self-contained on purpose — it does not depend on the other
 * R2 sub-modules so it can be unit-tested in isolation, and so TR2.5 can
 * compose it with whatever module types the pipeline settles on.
 */

/** A single transpiled module the wrapper will embed in the IIFE. */
export interface IIFEModule {
    /** Normalized relative path (e.g. 'App.tsx', 'components/Hello.tsx'). */
    path: string;
    /** Sucrase-transformed CommonJS-style code (output of `transform(..., {transforms: ['imports', ...]})`). */
    code: string;
}

export interface WrapOptions {
    /** Path of the entry module (must exist in `modules`). */
    entry: string;
    /** All transpiled modules. */
    modules: readonly IIFEModule[];
    /**
     * URL-prefixed bare imports the rewriter produced. The wrapper uses this to
     * emit an `<script type="importmap">` for the iframe HTML shell.
     * Example: ['react', 'react-native-web']
     */
    bareImports?: readonly string[];
    /** ESM CDN base URL (used to build the importmap entries). */
    esmUrl?: string;
}

export interface WrapResult {
    /** Self-contained JS that defines all modules and `require`s the entry. */
    code: string;
    /** Importmap JSON string ready for `<script type="importmap">${this}</script>`. */
    importmap: string;
}

const DEFAULT_ESM_URL = 'https://esm.sh';
const DEFAULT_EXTERNAL = 'react,react-dom,react-native,react-native-web';
const EXTENSION_FALLBACKS = ['.js', '.tsx', '.ts', '.jsx', '.mjs', '.cjs'] as const;

/**
 * Wrap a bundled module map in an IIFE. The produced code defines a
 * `__modules` object keyed by path, provides a minimal `require` runtime
 * (with relative-path resolution + extension fallbacks), then kicks off
 * execution with `require(entry)`.
 */
export function wrapAsIIFE(opts: WrapOptions): WrapResult {
    const { entry, modules, bareImports = [], esmUrl = DEFAULT_ESM_URL } = opts;

    if (!modules.some((m) => m.path === entry)) {
        throw new Error(`wrapAsIIFE: entry '${entry}' is not present in modules`);
    }

    const moduleEntries = modules
        .map((m) => `  ${JSON.stringify(m.path)}: function(module, exports, require) {\n${m.code}\n}`)
        .join(',\n');

    const runtime = `
var __modules = {
${moduleEntries}
};
var __cache = Object.create(null);
var __extensions = ${JSON.stringify(EXTENSION_FALLBACKS)};

function __resolveRelative(from, spec) {
  // from is a module path (file); use its directory as base
  var baseParts = from.split('/');
  baseParts.pop();
  var specParts = spec.split('/');
  for (var i = 0; i < specParts.length; i++) {
    var part = specParts[i];
    if (part === '' || part === '.') continue;
    if (part === '..') {
      if (baseParts.length === 0) {
        throw new Error("Cannot resolve '" + spec + "' from '" + from + "' (escapes root)");
      }
      baseParts.pop();
    } else {
      baseParts.push(part);
    }
  }
  return baseParts.join('/');
}

function __resolve(from, spec) {
  if (spec[0] !== '.' && spec[0] !== '/') {
    throw new Error("Bare import '" + spec + "' reached IIFE require; the rewriter should have replaced it");
  }
  var candidate = spec[0] === '/' ? spec.replace(/^\\/+/, '') : __resolveRelative(from, spec);
  if (__modules[candidate]) return candidate;
  for (var i = 0; i < __extensions.length; i++) {
    var withExt = candidate + __extensions[i];
    if (__modules[withExt]) return withExt;
  }
  // index fallback (e.g. ./components -> ./components/index.tsx)
  for (var j = 0; j < __extensions.length; j++) {
    var asIndex = (candidate === '' ? 'index' : candidate + '/index') + __extensions[j];
    if (__modules[asIndex]) return asIndex;
  }
  throw new Error("Module not found: " + spec + " (from " + from + ")");
}

function __makeRequire(from) {
  return function require(spec) {
    var resolved = __resolve(from, spec);
    if (__cache[resolved]) return __cache[resolved].exports;
    var module = { exports: {} };
    __cache[resolved] = module;
    var fn = __modules[resolved];
    fn(module, module.exports, __makeRequire(resolved));
    return module.exports;
  };
}

// Entry point
__makeRequire('')(${JSON.stringify('./' + entry)});
`;

    const code = `;(function(){\n${runtime}\n})();`;

    return {
        code,
        importmap: buildImportmap(bareImports, esmUrl),
    };
}

function buildImportmap(bareImports: readonly string[], esmUrl: string): string {
    const imports: Record<string, string> = {};
    for (const pkg of bareImports) {
        imports[pkg] = `${esmUrl}/${pkg}?bundle&external=${DEFAULT_EXTERNAL}`;
    }
    return JSON.stringify({ imports });
}

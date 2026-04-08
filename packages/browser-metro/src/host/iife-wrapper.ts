/**
 * IIFE wrapper for the browser-metro bundle.
 *
 * TR2.4: Takes the bundled module map + entry path and produces a single
 * self-contained JS string the iframe can ship in a <script> tag.
 *
 * The wrapper is self-contained on purpose — it does not depend on the other
 * R2 sub-modules so it can be unit-tested in isolation, and so TR2.5 can
 * compose it with whatever module types the pipeline settles on.
 *
 * FOUND-06b (2026-04-08): the rewriter (TR2.3) converts bare specifiers to
 * `https://esm.sh/...` URLs. Sucrase's `imports` transform then turns those
 * into synchronous `require('https://esm.sh/...')` calls in the module
 * bodies. Synchronous `require()` cannot fetch remote modules in a browser,
 * so the wrapper now:
 *
 *   1. Emits an **async** IIFE.
 *   2. At the top, uses dynamic `import()` (via Promise.all) to fetch every
 *      URL produced by the rewriter into a `__urlCache` keyed by URL.
 *   3. Teaches `__resolve` / `__makeRequire` to recognise URL specs and
 *      return the pre-fetched ES module namespace synchronously.
 *
 * Dynamic `import()` is resolved through a `__importer` hook (defaulting to
 * a real `import(url)`). Tests can inject `globalThis.__browserMetroImport`
 * to stub network fetches.
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
     * Bare imports the rewriter produced. Accepts either the original bare
     * specifiers (e.g. 'react', 'react-native-web') or the fully-rewritten
     * URLs (e.g. 'https://esm.sh/react?bundle&external=...'). URL entries
     * are pre-fetched via dynamic `import()` at IIFE startup; bare-name
     * entries are still used to build the legacy `<script type="importmap">`.
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
 * Wrap a bundled module map in an async IIFE. The produced code:
 *   1. Pre-fetches every URL spec in `bareImports` via dynamic `import()`.
 *   2. Defines a `__modules` object keyed by path.
 *   3. Provides a minimal `require` runtime with URL-aware resolution.
 *   4. Kicks off execution with `require(entry)`.
 */
export function wrapAsIIFE(opts: WrapOptions): WrapResult {
    const { entry, modules, bareImports = [], esmUrl = DEFAULT_ESM_URL } = opts;

    if (!modules.some((m) => m.path === entry)) {
        throw new Error(`wrapAsIIFE: entry '${entry}' is not present in modules`);
    }

    const moduleEntries = modules
        .map((m) => `  ${JSON.stringify(m.path)}: function(module, exports, require) {\n${m.code}\n}`)
        .join(',\n');

    // Collect unique URL specs from bareImports. The rewriter may supply a
    // mix of bare names ('react') and full URLs; only URLs need pre-fetch.
    const urlSpecs = Array.from(
        new Set(bareImports.filter((s) => s.startsWith('http://') || s.startsWith('https://'))),
    );
    const urlImportsLiteral = JSON.stringify(urlSpecs);
    const entryLiteral = JSON.stringify('./' + entry);

    const runtime = `
  var __importer = (typeof globalThis !== 'undefined' && globalThis.__browserMetroImport)
    ? globalThis.__browserMetroImport
    : function(u) { return import(u); };

  var __urlCache = Object.create(null);
  var __urlImports = ${urlImportsLiteral};
  await Promise.all(__urlImports.map(function(url) {
    return Promise.resolve(__importer(url)).then(function(ns) {
      __urlCache[url] = ns;
    }).catch(function(err) {
      console.error('[browser-metro] failed to import', url, err);
      throw err;
    });
  }));

  var __modules = {
${moduleEntries}
  };
  var __cache = Object.create(null);
  var __extensions = ${JSON.stringify(EXTENSION_FALLBACKS)};

  function __isUrl(spec) {
    return spec.indexOf('http://') === 0 || spec.indexOf('https://') === 0;
  }

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
    if (__isUrl(spec)) {
      if (__urlCache[spec]) return '__url:' + spec;
      throw new Error("URL not pre-fetched: " + spec);
    }
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
      if (__isUrl(spec)) {
        var cached = __urlCache[spec];
        if (!cached) throw new Error("URL not pre-fetched: " + spec);
        return cached;
      }
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
  __makeRequire('')(${entryLiteral});
`;

    const code = `;(async function(){\n${runtime}\n})();`;

    return {
        code,
        importmap: buildImportmap(bareImports, esmUrl),
    };
}

function buildImportmap(bareImports: readonly string[], esmUrl: string): string {
    const imports: Record<string, string> = {};
    for (const pkg of bareImports) {
        // Skip URL specs — they cannot appear as keys in a standard importmap.
        if (pkg.startsWith('http://') || pkg.startsWith('https://')) continue;
        imports[pkg] = `${esmUrl}/${pkg}?bundle&external=${DEFAULT_EXTERNAL}`;
    }
    return JSON.stringify({ imports });
}

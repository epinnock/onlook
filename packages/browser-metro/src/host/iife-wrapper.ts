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
     * Bare specifier names the source referenced (e.g. 'react',
     * 'react-native-web'). Used to build the legacy
     * `<script type="importmap">` block. Accepts URL entries too for
     * backwards compatibility, but they will be filtered out before going
     * into the importmap.
     */
    bareImports?: readonly string[];
    /**
     * Fully-rewritten URLs the produced module bodies reference (e.g.
     * `https://esm.sh/react-native-web?bundle&external=...`). The wrapper
     * pre-fetches each URL via dynamic `import()` at IIFE startup so the
     * synchronous `require()` shim can resolve them. If omitted, the
     * wrapper falls back to extracting URL specs from `bareImports`
     * (backwards-compat with the original TR2.4 contract).
     */
    bareImportUrls?: readonly string[];
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
    const {
        entry,
        modules,
        bareImports = [],
        bareImportUrls,
        esmUrl = DEFAULT_ESM_URL,
    } = opts;

    if (!modules.some((m) => m.path === entry)) {
        throw new Error(`wrapAsIIFE: entry '${entry}' is not present in modules`);
    }

    const moduleEntries = modules
        .map((m) => `  ${JSON.stringify(m.path)}: function(module, exports, require) {\n${m.code}\n}`)
        .join(',\n');

    // Collect unique URL specs to pre-fetch. Prefer the explicit
    // `bareImportUrls` list (the URL forms produced by TR2.3's rewriter).
    // Fall back to filtering URL entries out of `bareImports` for the
    // backwards-compat path used by older callers + tests that pass URLs
    // directly via the legacy `bareImports` field.
    const urlSpecs = Array.from(
        new Set(
            bareImportUrls && bareImportUrls.length > 0
                ? bareImportUrls
                : bareImports.filter(
                      (s) => s.startsWith('http://') || s.startsWith('https://'),
                  ),
        ),
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

  // Auto-runApplication fallback for raw \`AppRegistry.registerComponent\`-
  // style entries. Expo Router / \`expo\`'s \`registerRootComponent\` call
  // \`runApplication\` themselves, so this is a no-op there. The seed
  // template (and projects ported from non-expo RN code) only register
  // and never run — that's what produces the "Loading browser preview…"
  // hang in the iframe. Bisected against the running editor on
  // 2026-04-25 with hash 25a3e2e8 / cfa27395.
  //
  // We only fire when (a) react-native-web is in the URL cache (i.e.
  // the entry actually pulled it in), AND (b) #root still shows the
  // loading shim, meaning nothing rendered. Both checks are wrapped in
  // try/catch so a failure here can never mask a more useful error
  // from the user's bundle.
  try {
    var __rnwSpec = null;
    var __cacheKeys = Object.keys(__urlCache);
    for (var __i = 0; __i < __cacheKeys.length; __i++) {
      if (__cacheKeys[__i].indexOf('react-native-web') !== -1) {
        __rnwSpec = __cacheKeys[__i];
        break;
      }
    }
    if (
      __rnwSpec &&
      typeof document !== 'undefined' &&
      document.getElementById &&
      document.getElementById('__loading')
    ) {
      var __rnw = __urlCache[__rnwSpec];
      var __reg = __rnw && __rnw.AppRegistry;
      if (__reg && typeof __reg.runApplication === 'function') {
        var __root = document.getElementById('root') || document.body;
        // Drop the loading shim before runApplication mounts so it
        // doesn't sit underneath the rendered tree.
        var __loading = document.getElementById('__loading');
        if (__loading && __loading.parentNode) __loading.parentNode.removeChild(__loading);
        __reg.runApplication('main', { rootTag: __root });
      }
    }
  } catch (__autoRunErr) {
    if (typeof console !== 'undefined' && console.error) {
      console.error('[browser-metro] auto-runApplication fallback failed', __autoRunErr);
    }
  }
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

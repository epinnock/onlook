/**
 * build-runtime.ts — Builds the React Fabric runtime bundle.
 *
 * Bundles react + react-reconciler + scheduler + shell + host config
 * into a single CJS file wrapped in Metro module format.
 *
 * Output: packages/mobile-preview/runtime/bundle.js (~241KB)
 *
 * Run: bun run packages/mobile-preview/server/build-runtime.ts
 */

import { existsSync, readFileSync } from 'fs';
import { readdir, rm } from 'fs/promises';
import { dirname, join, relative } from 'path';

const ROOT = join(import.meta.dir, '..');
const RUNTIME_DIR = join(ROOT, 'runtime');
const GENERATED_ENTRY_NAME = '.generated-entry.js';
const SHIMS_DIR_NAME = 'shims';

export const DEFAULT_EXPO_SDK_VERSION = '54.0.0';
export const RUNTIME_BUILD_METADATA_FILENAME = 'bundle.meta.json';

export interface RuntimeBuildMetadata {
  sdkVersion: string;
}

function normalizeRelativeRuntimePath(path: string) {
  const normalizedPath = path.replaceAll('\\', '/');
  return normalizedPath.startsWith('.') ? normalizedPath : `./${normalizedPath}`;
}

async function collectRuntimeShimPaths(path: string, runtimeDir: string): Promise<string[]> {
  const entries = await readdir(path, { withFileTypes: true });
  const shimPaths: string[] = [];

  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    const entryPath = join(path, entry.name);

    if (entry.isDirectory()) {
      shimPaths.push(...(await collectRuntimeShimPaths(entryPath, runtimeDir)));
      continue;
    }

    if (!/\.(cjs|cts|js|jsx|mjs|mts|ts|tsx)$/.test(entry.name)) {
      continue;
    }

    shimPaths.push(normalizeRelativeRuntimePath(relative(runtimeDir, entryPath)));
  }

  return shimPaths;
}

export async function discoverRuntimeShimPaths(runtimeDir = RUNTIME_DIR) {
  const shimsDir = join(runtimeDir, SHIMS_DIR_NAME);

  if (!existsSync(shimsDir)) {
    return [];
  }

  return collectRuntimeShimPaths(shimsDir, runtimeDir);
}

export function createRuntimeEntrySource(shimPaths: string[]) {
  const lines = [
    "require('./shell.js');",
    "const registry = require('./registry.js');",
    ...shimPaths.map(
      shimPath =>
        `registry.registerRuntimeShim(require(${JSON.stringify(shimPath)}), ${JSON.stringify(shimPath)});`,
    ),
    'registry.applyRuntimeShims(globalThis);',
    "require('./runtime.js');",
    '',
  ];

  return lines.join('\n');
}

export function getRuntimeBuildMetadataPath(runtimeBundlePath: string): string {
  return join(dirname(runtimeBundlePath), RUNTIME_BUILD_METADATA_FILENAME);
}

export function readRuntimeBuildMetadata(runtimeBundlePath: string): RuntimeBuildMetadata | null {
  const metadataPath = getRuntimeBuildMetadataPath(runtimeBundlePath);
  if (!existsSync(metadataPath)) {
    return null;
  }

  return JSON.parse(readFileSync(metadataPath, 'utf-8')) as RuntimeBuildMetadata;
}

async function writeGeneratedRuntimeEntry(runtimeDir = RUNTIME_DIR) {
  const shimPaths = await discoverRuntimeShimPaths(runtimeDir);
  const entryPath = join(runtimeDir, GENERATED_ENTRY_NAME);

  await Bun.write(entryPath, createRuntimeEntrySource(shimPaths));

  return {
    entryPath,
    shimPaths,
  };
}

export async function buildRuntime() {
  console.log('[build-runtime] Bundling React runtime...');

  const { entryPath, shimPaths } = await writeGeneratedRuntimeEntry();
  const rawPath = join(RUNTIME_DIR, 'raw-bundle.js');
  const outPath = join(RUNTIME_DIR, 'bundle.js');

  try {
    console.log(
      `[build-runtime] Discovered ${shimPaths.length} runtime shim${shimPaths.length === 1 ? '' : 's'}.`,
    );

    const result = await Bun.build({
      entrypoints: [entryPath],
      outdir: RUNTIME_DIR,
      naming: 'raw-bundle.js',
      target: 'browser',
      format: 'cjs',
      minify: true,
    });

    if (!result.success) {
      console.error('[build-runtime] Build failed:', result.logs);
      process.exit(1);
    }

    const rawBundle = await Bun.file(rawPath).text();

    const esmLines = rawBundle.split('\n').filter(line => /^export |^import /.test(line));
    if (esmLines.length > 0) {
      console.error('[build-runtime] ESM leak detected:', esmLines);
      process.exit(1);
    }

    const preamble = `(function(g) {
  if (!g.performance) g.performance = { now: function() { return Date.now(); } };
  if (typeof g.setTimeout === "undefined") { var _t=1; g.setTimeout = function(fn,ms) { var id=_t++; if(!ms||ms<=0){fn();return id;} return id; }; g.clearTimeout = function(){}; }
  if (typeof g.MessageChannel === "undefined") { g.MessageChannel = function() { var _c=null; this.port1={}; this.port2={postMessage:function(){if(_c){var f=_c;g.setTimeout(function(){f({data:undefined});},0);}}}; Object.defineProperty(this.port1,"onmessage",{set:function(v){_c=v;},get:function(){return _c;}}); }; }
  if (typeof g.queueMicrotask === "undefined") { g.queueMicrotask = function(fn) { Promise.resolve().then(fn); }; }
  if (!g.console) { g.console={log:function(){},warn:function(){},error:function(){},info:function(){},debug:function(){}}; }
  if (!g.process) g.process = { env: { NODE_ENV: "production" } };
  g._log = function(msg) { try { if (typeof g.nativeLoggingHook === "function") g.nativeLoggingHook("[ONLOOK] " + msg, 1); } catch(_) {} };
})(typeof globalThis !== "undefined" ? globalThis : typeof self !== "undefined" ? self : this);
var __modules={};function __d(f,i,d){__modules[i]={factory:f,hasError:false,importedAll:false,exports:{}};}function __r(i){var m=__modules[i];if(!m)throw new Error("Module "+i+" not registered");if(!m.importedAll){m.importedAll=true;try{m.factory.call(m.exports,typeof globalThis!=="undefined"?globalThis:typeof self!=="undefined"?self:this,__r,null,m.exports,m,m.exports,null);}catch(e){m.hasError=true;if(typeof globalThis.nativeLoggingHook==="function"){globalThis.nativeLoggingHook("[ONLOOK] Module error: "+(e&&e.message),1);}throw e;}}return m.exports;}
__d(function(global,require,_imports,_exports,module,exports,_dependencyMap){
`;
    const suffix = '\n}, 0, []);\n__r(0);\n';

    await Bun.write(outPath, preamble + rawBundle + suffix);
    await Bun.write(
      getRuntimeBuildMetadataPath(outPath),
      `${JSON.stringify({ sdkVersion: DEFAULT_EXPO_SDK_VERSION }, null, 2)}\n`,
    );

    await rm(rawPath, { force: true });

    const stats = await Bun.file(outPath).size;
    console.log(`[build-runtime] Output: ${outPath} (${(stats / 1024).toFixed(1)} KB)`);
    console.log('[build-runtime] Done.');
  } finally {
    await rm(entryPath, { force: true });
  }
}

if (import.meta.main) {
  buildRuntime().catch(error => {
    console.error(error);
    process.exit(1);
  });
}

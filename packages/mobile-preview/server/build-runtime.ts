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

import { join } from 'path';

const ROOT = join(import.meta.dir, '..');

async function build() {
  console.log('[build-runtime] Bundling React runtime...');

  const result = await Bun.build({
    entrypoints: [join(ROOT, 'runtime', 'entry.js')],
    outdir: join(ROOT, 'runtime'),
    naming: 'raw-bundle.js',
    target: 'browser',
    format: 'cjs',
    minify: true,
  });

  if (!result.success) {
    console.error('[build-runtime] Build failed:', result.logs);
    process.exit(1);
  }

  const rawPath = join(ROOT, 'runtime', 'raw-bundle.js');
  const outPath = join(ROOT, 'runtime', 'bundle.js');
  const rawBundle = await Bun.file(rawPath).text();

  // Check for ESM leaks
  const esmLines = rawBundle.split('\n').filter(l => /^export |^import /.test(l));
  if (esmLines.length > 0) {
    console.error('[build-runtime] ESM leak detected:', esmLines);
    process.exit(1);
  }

  // Wrap in polyfills + Metro module system
  const preamble = `(function(g) {
  if (!g.performance) g.performance = { now: function() { return Date.now(); } };
  if (typeof g.setTimeout === "undefined") { var _t=1; g.setTimeout = function(fn,ms) { var id=_t++; if(!ms||ms<=0){fn();return id;} return id; }; g.clearTimeout = function(){}; }
  if (typeof g.MessageChannel === "undefined") { g.MessageChannel = function() { var _c=null; this.port1={}; this.port2={postMessage:function(){if(_c){var f=_c;g.setTimeout(function(){f({data:undefined});},0);}}}; Object.defineProperty(this.port1,"onmessage",{set:function(v){_c=v;},get:function(){return _c;}}); }; }
  if (typeof g.queueMicrotask === "undefined") { g.queueMicrotask = function(fn) { Promise.resolve().then(fn); }; }
  if (!g.console) { g.console={log:function(){},warn:function(){},error:function(){},info:function(){},debug:function(){}}; }
  if (!g.process) g.process = { env: { NODE_ENV: "production" } };
  g._log = function(msg) { try { if (typeof g.nativeLoggingHook === "function") g.nativeLoggingHook("[ONLOOK] " + msg, 1); } catch(_) {} };
})(typeof globalThis !== "undefined" ? globalThis : typeof self !== "undefined" ? self : this);
(function(){
var __modules={};function __d(f,i,d){__modules[i]={factory:f,hasError:false,importedAll:false,exports:{}};}function __r(i){var m=__modules[i];if(!m)throw new Error("Module "+i+" not registered");if(!m.importedAll){m.importedAll=true;try{m.factory.call(m.exports,typeof globalThis!=="undefined"?globalThis:typeof self!=="undefined"?self:this,__r,null,m.exports,m,m.exports,null);}catch(e){m.hasError=true;if(typeof globalThis.nativeLoggingHook==="function"){globalThis.nativeLoggingHook("[ONLOOK] Module error: "+(e&&e.message),1);}throw e;}}return m.exports;}
__d(function(global,require,_imports,_exports,module,exports,_dependencyMap){
`;
  // After __r(0) runs the full module tree (shell.js → runtime.js), React
  // and createElement are on globalThis. Inside Hermes (where main.jsbundle
  // follows), delete them so the main bundle's React is authoritative —
  // prevents the dual-React hooks crash (useState of null).
  // __turboModuleProxy is a Hermes-native global absent in browsers.
  const suffix = '\n}, 0, []);\n__r(0);\nif(typeof globalThis.__turboModuleProxy!=="undefined"){delete globalThis.React;delete globalThis.createElement;}\n})();\n';

  await Bun.write(outPath, preamble + rawBundle + suffix);

  // Clean up raw bundle
  const fs = require('fs');
  fs.unlinkSync(rawPath);

  const stats = await Bun.file(outPath).size;
  console.log(`[build-runtime] Output: ${outPath} (${(stats / 1024).toFixed(1)} KB)`);
  console.log('[build-runtime] Done.');
}

build().catch(console.error);

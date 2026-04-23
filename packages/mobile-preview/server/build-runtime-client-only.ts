/**
 * build-runtime-client-only.ts — builds the mobile-client-only runtime bundle.
 *
 * The Onlook Mobile Client (bridgeless + new-arch Hermes) intentionally
 * skips `runtime.js` via `globalThis.__noOnlookRuntime = true`. With the
 * default `entry.js` entry, runtime.js's 241KB of React + reconciler +
 * scheduler still ships in the bundle — dead weight on the client. This
 * build uses `entry-client-only.js` which requires only `shell.js`,
 * producing a ~15–20KB bundle.
 *
 * Output: packages/mobile-preview/runtime/bundle-client-only.js
 *
 * Run: bun run packages/mobile-preview/server/build-runtime-client-only.ts
 *
 * Sibling to `build-runtime.ts`; the preamble + Metro module wrapper is
 * identical to the default build so shell.js's globals and the `__r(0)`
 * invocation land exactly as they do in the full bundle.
 */

import { join } from 'path';

const ROOT = join(import.meta.dir, '..');

async function build(): Promise<void> {
    console.log('[build-runtime-client-only] Bundling shell.js-only runtime...');

    const result = await Bun.build({
        entrypoints: [join(ROOT, 'runtime', 'entry-client-only.js')],
        outdir: join(ROOT, 'runtime'),
        naming: 'raw-bundle-client-only.js',
        target: 'browser',
        format: 'cjs',
        minify: true,
    });

    if (!result.success) {
        console.error('[build-runtime-client-only] Build failed:', result.logs);
        process.exit(1);
    }

    const rawPath = join(ROOT, 'runtime', 'raw-bundle-client-only.js');
    const outPath = join(ROOT, 'runtime', 'bundle-client-only.js');
    const rawBundle = await Bun.file(rawPath).text();

    const esmLines = rawBundle.split('\n').filter((l) => /^export |^import /.test(l));
    if (esmLines.length > 0) {
        console.error('[build-runtime-client-only] ESM leak detected:', esmLines);
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
(function(){
var __modules={};function __d(f,i,d){__modules[i]={factory:f,hasError:false,importedAll:false,exports:{}};}function __r(i){var m=__modules[i];if(!m)throw new Error("Module "+i+" not registered");if(!m.importedAll){m.importedAll=true;try{m.factory.call(m.exports,typeof globalThis!=="undefined"?globalThis:typeof self!=="undefined"?self:this,__r,null,m.exports,m,m.exports,null);}catch(e){m.hasError=true;if(typeof globalThis.nativeLoggingHook==="function"){globalThis.nativeLoggingHook("[ONLOOK] Module error: "+(e&&e.message),1);}throw e;}}return m.exports;}
__d(function(global,require,_imports,_exports,module,exports,_dependencyMap){
`;
    const suffix = '\n}, 0, []);\n__r(0);\n})();\n';

    await Bun.write(outPath, preamble + rawBundle + suffix);

    const fs = require('fs');
    fs.unlinkSync(rawPath);

    const stats = await Bun.file(outPath).size;
    const fullBundle = join(ROOT, 'runtime', 'bundle.js');
    let savings = '';
    try {
        const fullSize = await Bun.file(fullBundle).size;
        const delta = fullSize - stats;
        const pct = ((delta / fullSize) * 100).toFixed(1);
        savings = ` — saves ${(delta / 1024).toFixed(1)} KB (${pct}%) vs bundle.js`;
    } catch {
        /* bundle.js not built yet, skip the comparison */
    }
    console.log(
        `[build-runtime-client-only] Output: ${outPath} (${(stats / 1024).toFixed(1)} KB)${savings}`,
    );
    console.log('[build-runtime-client-only] Done.');
}

build().catch((err) => {
    console.error('[build-runtime-client-only] FAIL:', err);
    process.exit(1);
});

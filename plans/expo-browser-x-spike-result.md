# TX0.1 Spike — react-native@0.81.0 as ESM library bundle

**Date:** 2026-04-08
**Spike author:** orchestrator (run inline before dispatching Wave X1+)
**Tool tested:** esbuild 0.24.2 + babel 7.x + @react-native/babel-preset
**Workspace:** `/tmp/spike-rn-esm/` (throwaway, can rm -rf)

---

## RESULT: FAIL

**Decision:** Phase X must NOT be dispatched. The premise that the cf-esm-builder Container can build `react-native` as a standalone ESM library is architecturally unsound for the Expo Go phone path. The original Phase H Container architecture (which the Phase X queue was meant to correct) is in fact the correct architecture for this use case. The "correction" was based on a wrong understanding of how RN's runtime works.

---

## What I tried (chronological)

### Attempt 1 — naive esbuild (no preprocessor)

```bash
esbuild ./node_modules/react-native/index.js \
  --bundle --format=esm --platform=neutral --target=es2022 \
  --external:react --external:react-dom \
  --outfile=./dist-attempt-1.mjs
```

**Failed at line 1.** `react-native/index.js:27` uses Flow syntax (`import typeof * as ReactNativePublicAPI from './index.js.flow'`). esbuild has no built-in Flow support.

### Attempt 2 — esbuild + flow-remove-types plugin

Wrote a plugin that runs `flow-remove-types` on every `.js` file under `react-native/`. Surfaced 8 errors:

1. **Component Syntax** — `react-native/Libraries/Components/View/View.js:26` uses `component View(ref?: React.RefSetter<...>, ...props: ViewProps) { ... }`. This is React's experimental Component Syntax (TC39 stage-1, only supported by Hermes parser + Babel with `@babel/plugin-syntax-component-syntax`). flow-remove-types does NOT handle it.
2. **PNG file imports** — `LogBoxImages/loader.png` etc. require an asset loader.
3. **Unresolved `.ios.js`/`.android.js`** — `setUpReactDevTools.js` requires `ReactDevToolsSettingsManager` which only exists as platform-suffixed files. esbuild's default `resolveExtensions` excludes them.

### Attempt 3 — esbuild + babel + @react-native/babel-preset

The only transformer that actually understands all of RN's syntax (component syntax, Flow, JSX, RN-specific babel transforms) is babel with `@react-native/babel-preset`. Wrote an esbuild plugin that pipes every RN-flavored `.js` file through babel.

```js
// build-babel.mjs (excerpt)
const result = await babel.transformAsync(source, {
  presets: ['@react-native/babel-preset'],
});
```

Build performance: **15s, 514 file transforms, 14s of which is babel time** (esbuild itself is ~1s). 36x slower than the "esbuild can do react-native in ~1-2s" assumption that motivated Phase X.

After also adding:
- `resolveExtensions: ['.android.js', '.android.jsx', '.native.js', ...]` (forces a single-platform bundle)
- `loader: { '.png': 'empty', '.ttf': 'empty', ... }` (stub native assets)
- `define: { __DEV__: 'false', 'process.env.NODE_ENV': '"production"' }`

**Build succeeded.** 2.3 MB ESM file at `/tmp/spike-rn-esm/dist/index.mjs`.

### Attempt 4 — runtime smoke test in Node

```bash
node --input-type=module -e "
  import RN from './dist/index.mjs';
  console.log('keys count:', Object.keys(RN).length);  // → 84
  console.log('View:', typeof RN?.View);                // → triggers lazy getter
"
```

**Failed at runtime** with `TypeError: _interopRequireDefault2 is not a function`. Cause: babel injects `_interopRequireDefault` calls as runtime helpers, then esbuild's CJS-to-ESM converter mangles the helper namespace. Fixable with babel option `disableImportExportTransform: true`, but it doesn't matter because of the next finding.

### Attempt 5 — inspect the bundle contents

```bash
grep -E '^export' dist/index.mjs
# → export default require_index();   (THE ONLY EXPORT)
```

**The bundle has exactly one export: `default`.** Reason: react-native's `index.js` is CommonJS:

```js
module.exports = {
  get View() { return require('./Libraries/Components/View/View').default; },
  get Text() { return require('./Libraries/Text/Text').default; },
  // ...80 more lazy getters
};
```

esbuild's CJS-to-ESM converter wraps the entire `module.exports` object as a single `default` export. **There are no named exports.** Every consumer's `import { View, Text } from 'react-native'` would have to be rewritten to `import RN from 'react-native'; const { View, Text } = RN;`.

That alone is fixable with a wrapper module, but…

### Attempt 6 — inspect the bundle for runtime globals

```bash
grep -E 'global\.__|nativeFlushQueueImmediate|__fbBatchedBridge' dist/index.mjs
```

The bundle contains:

```js
Object.defineProperty(global, "__fbBatchedBridge", { configurable: true, value: BatchedBridge });
global.__fbGenNativeModule = genModule;
global.nativeFlushQueueImmediate(queue);
global[global.__METRO_GLOBAL_PREFIX__ || "" + "__SYSTRACE"] = Systrace;
```

**This is the killer finding.** The library bundle is not just *referencing* RN runtime globals — it's *initializing* them. When loaded inside Expo Go, this code would:

1. Create a NEW `BatchedBridge` MessageQueue instance
2. Overwrite `global.__fbBatchedBridge`, **disconnecting Expo Go's already-initialized native bridge** (which had registered all the iOS/Android native modules at app launch)
3. Instantiate a fresh `NativeModules` registry with no native modules registered
4. Every subsequent native call would fail because the new bridge doesn't know about ViewManager, AppRegistry, ImageLoader, etc.

This means **two copies of RN cannot coexist in the same JS context.** The library bundle approach cannot be glued onto an Expo Go runtime that has already loaded RN. Period.

---

## Why the Phase X premise was wrong

The Phase X queue was built on the analogy: *"react-native is a library like lodash. Build it once into ESM, cache it, consume from many projects."*

That analogy is wrong because **react-native is not a library — it's the runtime itself.** RN's source files aren't typical library code that just exports functions; they're the JS half of a JS↔native bridge that initializes itself on first import (`global.__fbBatchedBridge = ...`), registers itself with the native side, and assumes there is exactly ONE copy of itself in the JS context.

Metro doesn't bundle RN as a library because doing so would break this contract. Metro inlines RN's source files into the same bundle as the user's app code — there's only one BatchedBridge, one NativeModules, one AppRegistry. The "library Metro mode" hypothesis in TX1.2 doesn't exist in real Metro because real Metro never separates RN from the app.

The original parent queue Wave F (which I'd referenced as "the Container was for building libraries") was about building **web-compatible, runtime-independent npm packages** (lodash, date-fns, zod, react-native-svg's pure-JS bits) for **browser-metro consumption in the canvas iframe**. Those packages don't have RN's bridge problem. They CAN be built once and reused.

**I conflated two different "library" use cases:**
- ✅ Wave F (browser-metro libraries): pre-build pure-JS NPM packages for canvas iframe consumption — VALID
- ❌ Phase X (cf-esm-cache RN library): pre-build react-native for Expo Go consumption — INVALID

---

## What this means for the architecture

### Phase H (the "wrong" architecture I built in PR #9) is actually correct

The original Phase H Container approach — Metro bundles the user's project + RN + all deps into one bundle, Hermes optionally compiles, R2-cache it, serve via cf-expo-relay manifest URL — is the **only architecturally sound way** to support Expo Go. There is no shortcut.

The "wasteful per-project bundling" criticism still has some validity, but the optimization opportunity is **not** "split RN out into a library." It's:

1. **Content-addressable caching by source-tar hash** — first build is ~30s, repeat builds (no source change) are instant. Already implemented in Phase H.
2. **Incremental delta bundles via Metro's HMR protocol** — subsequent edits send only changed module IDs, not a full rebuild. ~200-500ms per delta.
3. **Pre-warmed Container instances** — keep N hot containers ready so cold-start is amortized away.
4. **Skip Hermes on dev builds** — JSC source is fine for dev preview, Hermes only matters for production size. Saves ~10-15s per build.

These optimizations are tractable follow-ups to PR #9, NOT a corrective rewrite.

### What about browser-metro and the canvas iframe?

Phase R stays exactly as it is. browser-metro bundles for `target: 'web'` (react-native-web), runs in the canvas iframe in the user's tab. Sub-second per edit. **This is correct and unaffected by the spike.**

The phone path (Expo Go) and the canvas path (web preview) are fundamentally different runtimes and need fundamentally different bundling pipelines. Trying to unify them via "one ESM library" doesn't work.

---

## Recommended action

**Do NOT dispatch Wave X1+.** Instead:

1. **Update `plans/expo-browser-status.md`** with the spike findings — credit the architectural finding to the spike, not to "wrong assumption I caught later."
2. **Keep `plans/expo-browser-x-queue.md` as a historical record** of the corrective attempt that the spike disproved. Add a banner at the top: `STATUS: BLOCKED — TX0.1 spike returned FAIL on 2026-04-08. Do not dispatch. See plans/expo-browser-x-spike-result.md.`
3. **Open a new follow-up plan** — `plans/expo-browser-h-optimization.md` — that catalogues the four real optimization opportunities listed above (content-addressable cache, HMR delta, container warmup, skip-Hermes-on-dev). Each is a tractable single-task fix to PR #9, not a 49-task rewrite.
4. **Phase Q (QR code UI) is unblocked and stays as-is** — the legacy ExpoQrButton already wires the Phase H flow correctly via `usePreviewOnDevice`.

---

## Spike artifacts (cleanup)

```bash
rm -rf /tmp/spike-rn-esm
# (preserves the workspace if you want to re-verify; otherwise safe to delete)
```

Files in the spike workspace:
- `package.json`, `node_modules/` — npm install of react-native@0.81.0 + react@19.1.0 + esbuild + babel
- `build.mjs` — first attempt with flow-remove-types (failed)
- `build-babel.mjs` — second attempt with babel preset (built but unusable)
- `dist/index.mjs` — the 2.3 MB ESM bundle that "succeeded" but is architecturally broken

---

## RESULT

```
RESULT: FAIL
```

(The marker line above is the first thing every Wave X1+ agent reads. As long as this line says FAIL, no agent will start work on the Phase X corrective queue.)

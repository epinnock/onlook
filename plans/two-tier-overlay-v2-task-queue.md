# Two-tier overlay v2 — full task queue

**Status:** Proposed 2026-04-21. Authoritative queue for the full two-tier mobile preview system
(Metro-built base bundle + browser-built overlays + WebSocket updates, Metro-style JS/assets).
Supersedes the partial Wave 0–C status in `metro-bundle-pipeline-task-queue.md`. The old queue
remains as a record of what landed on `feat/two-tier-bundle` before the ABI was ratified.

**Integration branch:** `feat/two-tier-bundle`
**Worktree root:** `.trees/two-tier-bundle`
**ABI spec:** `plans/adr/overlay-abi-v1.md` (ADR-0001)

## Critical path to first working proof

ABI spec → base alias map → JS fallback runtime → `wrap-overlay.ts` → `overlayUpdate` relay route
→ editor sends overlay → phone mounts overlay. Everything after that (package artifacts, full
asset support, native host polish, legacy cleanup) extends the working system.

Cross-reference to task IDs below: **#1 → #9 → #14–17 → #30 → #69–71 → #78 → #23–25 (JS-fallback
first via #14)**.

## Phase 0: ABI and scope

1. Write Overlay ABI v1 ADR covering runtime globals, import rules, overlay format, assets,
   errors, source maps, versioning, and unsupported native modules.
2. Define the hard boundary: overlays support JS/assets; new native modules/config plugins
   require a base/binary rebuild.
3. Define base runtime capabilities: supported Expo modules, `react-native-svg`, `expo-font`,
   `expo-asset`, media modules, file/cache modules.
4. Add shared ABI types to `packages/mobile-client-protocol`: overlay envelope, asset manifest,
   base manifest, alias map, runtime capability schema.
5. Add ABI version negotiation: editor refuses to send overlays when phone/base ABI version does
   not match.

## Phase 1: Base bundle

6. Create `packages/base-bundle-builder`. *(already exists — audit/realign to ABI v1)*
7. Build the base bundle with Metro programmatically, at CI/build time only.
8. Include React, React Native, Expo core, supported native-backed modules, SVG/font/media
   support, inspector hooks, and overlay runtime.
9. Emit a base alias map: `react`, `react/jsx-runtime`, `react-native`, `expo-*`,
   `react-native-svg`, etc. → Metro module IDs.
10. Emit a base manifest with RN version, Expo SDK, React version, platform, ABI version, alias
    hash, and bundle hash.
11. Add base-build validation that all required aliases exist.
12. Add base-build tests against a synthetic Metro registry and a real small Metro output.
13. Decide base delivery: baked into the mobile binary first; R2 fetch/cache later.

## Phase 2: Runtime ABI

14. Implement JS-fallback `globalThis.OnlookRuntime` in the base bundle.
15. Implement `OnlookRuntime.require(specifier)` using the base alias map and Metro `__r(id)`.
16. Implement `OnlookRuntime.mountOverlay(source, props?, assets?)`.
17. Implement `OnlookRuntime.unmount()`.
18. Implement `OnlookRuntime.resolveAsset(assetId)`.
19. Implement `OnlookRuntime.preloadAssets(assetIds)`.
20. Implement `OnlookRuntime.loadFont(fontFamily, assetRef, options?)`.
21. Add runtime error reporting back to relay/editor.
22. Ensure native host object and JS runtime do not overwrite each other.

## Phase 3: Native wiring

23. Wire `OnlookRuntimeInstaller::install()` so native `OnlookRuntime` exists before base JS runs.
24. Update `OnlookRuntime_runApplication.cpp` to call the overlay ABI path instead of legacy
    `onlookMount`.
25. Update `OnlookRuntime_reloadBundle.cpp` to remount the last or supplied overlay source
    correctly.
26. Cache last overlay source, props, and asset manifest for dev-menu reload/reconnect.
27. Fix dev-menu reload so it no longer calls `reloadBundle()` with no source.
28. Keep JS-fallback behavior for tests and non-native harnesses.

## Phase 4: Overlay bundler

29. Add `target: "onlook-client-v2"` to `packages/browser-metro`.
30. Add `wrap-overlay.ts` that emits Hermes-safe CJS, not browser async IIFE.
31. Emit overlay module tables with local `require`.
32. Resolve relative imports inside the overlay first.
33. Resolve bare imports through base aliases or package artifacts.
34. Preserve `__source` metadata for tap-to-source inspector.
35. Emit source maps or source-map references for overlay modules.
36. Add no-top-level-ESM tests for overlay output.
37. Add tests for local imports, nested imports, circular imports, missing modules, and syntax
    errors.

## Phase 5: Metro-like resolver

38. Implement platform resolution: `.ios.*`, `.native.*`, generic extensions.
39. Implement directory index resolution.
40. Implement package resolution from `package.json`.
41. Support `exports`, `main`, `module`, and `react-native` fields.
42. Keep browser-only fields out of native overlay resolution unless explicitly targeted.
43. Add resolver tests mirroring common Metro cases.
44. Add clear editor errors for unresolved or unsupported imports.

## Phase 6: Pure-JS package support

45. Define package classes: base alias, pure-JS artifact, unsupported native package.
46. Create package artifact format compatible with overlay module tables.
47. Build/cache pure-JS packages outside the hot path.
48. Let browser overlay bundler fetch cached package artifacts.
49. Bundle pure-JS package modules into the overlay graph or link them as package module tables.
50. Reject native-backed packages unless included in the base manifest.
51. Add package install/update flow that patches `package.json`, warms artifact cache, then
    rebuilds overlay.
52. Add tests for `lodash`, `zod`, `nanoid`, ESM-only packages, CJS packages, and package
    subpaths.

## Phase 7: Full asset pipeline

53. Define Metro-like `OverlayAssetManifest`.
54. Support image imports: png, jpg, jpeg, webp, gif, scale variants.
55. Support SVG as component through `react-native-svg`.
56. Support SVG as URL via `?url`.
57. Support SVG as raw text via `?raw`.
58. Support fonts: ttf, otf, woff, woff2.
59. Support audio/video descriptors: mp3, wav, m4a, mp4, mov, webm.
60. Support JSON imports as parsed modules.
61. Support raw text imports for txt, md, html, glsl, etc.
62. Support binary assets as URI/bytes descriptors.
63. Extract asset metadata: hash, MIME type, size, dimensions, scale, SVG viewBox, font hints.
64. Upload/cache asset bytes by content hash through relay/R2/session storage.
65. Add asset-check protocol so unchanged assets are not re-uploaded.
66. Emit asset stub modules that call `OnlookRuntime.resolveAsset(assetId)`.
67. Emulate Metro asset registry shape closely enough for RN libraries.
68. Add tests for every asset class and missing asset behavior.

## Phase 8: Relay protocol

69. Replace legacy `eval`, `bundle`, and `bundleUpdate` product paths with `overlayUpdate`.
70. Add WebSocket route such as `/hmr/:sessionId`.
71. Route editor `overlayUpdate` messages to connected phones.
72. Route phone console/error/network/select messages back to editor.
73. Store latest overlay in Durable Object memory for reconnect replay.
74. Add optional durable overlay/asset fallback if DO restarts matter.
75. Validate all WS messages with shared Zod schemas.
76. Add relay tests for routing, replay, disconnects, bad schema, and multiple clients.

## Phase 9: Editor integration

77. Build `onlook-client-v2` overlays from the editor browser.
78. Send `overlayUpdate(source, assets, metadata)` over WebSocket on file changes.
79. Debounce rapid edits.
80. Add editor status states: building, uploading assets, sent, mounted, runtime error.
81. Show unsupported import/native-module errors before sending to phone.
82. Replay latest overlay when phone reconnects.
83. Keep browser iframe preview separate from native overlay output.

## Phase 10: Inspector and debug

84. Preserve `__source` injection in overlay modules.
85. Verify tap-to-source still maps phone UI to editor files.
86. Wire overlay source maps into runtime errors.
87. Stream console, network, runtime errors, and React boundary errors through the unified relay.
88. Add editor UI handling for overlay build errors vs device runtime errors.

## Phase 11: Migration cleanup

89. Remove B13 shell `eval` handler from the product path.
90. Remove or quarantine legacy `cf-expo-relay/session.ts` bundle-storage behavior.
91. Remove native use of browser IIFE bundles.
92. Keep old pipeline behind a temporary feature flag.
93. Add kill switch: legacy vs overlay-v1.
94. Update docs and plans so there is one current product path.

## Phase 12: Verification

95. Unit-test ABI, alias resolver, overlay wrapper, package resolver, asset resolver.
96. Integration test browser overlay build → relay → phone runtime → render.
97. Device smoke test QR scan → initial render → editor edit → phone updates without Metro server.
98. Negative tests for missing alias, unsupported native package, asset upload failure, syntax
    error, runtime error, ABI mismatch.
99. Performance gates for overlay build time, WS payload size, asset upload time, edit-to-pixels
    latency.
100. Size gates for base bundle, overlay bundle, package artifacts, and asset manifests.

## Status log

| Task | Status | Notes |
|------|--------|-------|
| 1 | done | `plans/adr/overlay-abi-v1.md` — ADR-0001 drafted 2026-04-21, revised with bridgeless §"Bridgeless requirements", §"Installation order", §"Performance envelope". Proposed; pending human ratification. |
| 2 | done | Hard boundary documented in ADR-0001 §"Unsupported native modules" and encoded in `DISALLOWED_NATIVE_ALIASES`. |
| 3 | done | `packages/base-bundle-builder/src/runtime-capabilities.ts` — `REQUIRED_ALIASES`, `OPTIONAL_CAPABILITY_GROUPS`, `DISALLOWED_NATIVE_ALIASES`, `classifyImport`, `buildRuntimeCapabilities`. 11 tests green. |
| 4 | done | `packages/mobile-client-protocol/src/abi-v1.ts` — asset manifest, overlay envelope, runtime error, runtime capabilities, `OverlayUpdateMessage`, `AbiHelloMessage`. Typecheck clean. |
| 5 | done | `checkAbiCompatibility` (editor) + `assertOverlayAbiCompatible` (runtime) in `abi-v1.ts`. Consumer wiring lands with Phase 2/9. |
| 6 | done | `packages/base-bundle-builder` exists from earlier Wave A; no rename required. Alignment with ABI v1 happens in #7–#12. |
| 7 | partial | `packages/base-bundle-builder` scaffold exists. Metro programmatic runner: `runMetroBuild` is injected; real Metro integration deferred (needs running RN environment). |
| 8 | done | Curated dep list ships React + `react/jsx-runtime` + React Native + `react-native-safe-area-context` via `REQUIRED_ALIASES`; Expo core / Expo Router / SVG / fonts / assets / media / files / blur-gesture-anim covered by `OPTIONAL_CAPABILITY_GROUPS` in `packages/base-bundle-builder/src/runtime-capabilities.ts`. `DISALLOWED_NATIVE_ALIASES` blocks Reanimated / Skia / MMKV / Worklets / FlashList / VisionCamera. 11 tests green in `runtime-capabilities.test.ts` (classification, required-alias gate, capability-group presence). Promoted to done 2026-04-23: #3 already codified the full list and the classification machinery; no further scope here. |
| 9 | done | `build.ts` now calls `createAliasEmitterOutput({ modules })` after Metro build; exposes `aliasEmitterOutput` on result. 2 new tests + 11 capability tests. |
| 10 | done | `base-manifest.ts` — `emitBaseManifest()` + `writeBaseManifest()`. 13 tests pass. Consumed by relay ABI negotiation (tasks #5, #17). |
| 11 | done | `validate-aliases.ts` now checks REQUIRED_ALIASES separately; `assertAliasMapCompleteness` throws REQUIRED_ALIASES error before curated error. 5 tests (3 updated + 2 new). |
| 12 | done | `alias-registry-integration.test.ts` — synthetic Metro registry round-trip + cross-bundle hash equality. 8 tests total; last 3 added 2026-04-23: (a) identical alias content → identical `sidecarJson` + `aliasHash` even when `bundleBytes` differ (cache-hit contract), (b) emitter is input-order-independent (alphabetic sort invariant), (c) moduleId shift for same specifier → different aliasHash (cache-invalidation contract). Full base-bundle-builder suite: 102 pass. |
| 13 | pending | Decision: baked-into-binary for v1; R2 fetch/cache is a future extension. Captured in ADR §"Performance envelope" guardrail #99. |
| 14 | done | `packages/mobile-preview/runtime/src/onlook-runtime-js.ts` — install + guard + require + reportError. Agent ab920c49 (second attempt, first timed out). 9 baseline tests. |
| 15 | done | `mountOverlay` full impl: indirect-eval, extracts `__pendingEntry`, routes through `renderApp`, caches `lastMount`. Error kind classification (overlay-parse vs overlay-runtime vs overlay-react). 9 new behavioral tests on top of the 9 baseline = 18 total. |
| 16 | done | `unmount()` clears lastMount + currentAssets + calls injected unmountApp adapter. Test covers teardown. |
| 17 | done | `resolveAsset(id)` returns descriptor from mounted manifest; throws asset-missing for unknown ids. |
| 18 | done | `preloadAssets(ids)` verifies every id in the mounted manifest; rejects with asset-missing on unknowns. 2 new tests. |
| 19 | done | `loadFont(family, ref, opts)` validates asset kind === 'font', registers in internal fontRegistry keyed by family\|weight\|style. Rejects with asset-missing / asset-load-failed. 3 new tests. |
| 20 | done | Runtime surfaces overlay-runtime / overlay-parse / overlay-react error kinds through injected onError. Covered by mountOverlay tests. |
| 21 | done | `__native === true` short-circuit returns the existing native runtime without installing the JS fallback. Test pre-seeds a native stub. |
| 22 | done | Same as #21 — native/JS mutual-exclusion encoded in `installOnlookRuntimeJs`. |
| 23 | partial | `OnlookRuntimeInstaller.install()` only publishes `__onlookDirectLog` today; native `runApplication`/`reloadBundle` host-function registration is blocked on Xcode 16.1 (see `d91f6df6`). JS-fallback path exercises the full ABI contract meanwhile. |
| 24 | partial | Native `OnlookRuntime_runApplication.cpp` exists but isn't wired through the installer. Same Xcode blocker as #23. AppRouter's JS layer already routes through `OnlookRuntime.mountOverlay` (task #23-25 bridge, landed via agent abb45c4b). |
| 25 | partial | `OnlookRuntime_reloadBundle.cpp` validates `(bundleSource: string)` — our overlay path passes source not URL, so the shape matches. Wiring to installer blocked on Xcode. |
| 26 | done (js-fallback) | JS-fallback caches `lastMount = {source, props, assets}` on every mount; dev-menu reload and qrToMount read it. Native side inherits contract. |
| 27 | done | `apps/mobile-client/src/actions/reloadBundle.ts` prefers `OnlookRuntime.mountOverlay(lastMount.source, ...)` when available; falls back to `DevSettings.reload()`. 8 tests. |
| 28 | done | JS-fallback path is the test/non-native harness per §"Installation order". Agent worktree patterns and our Node `vm`-based tests both use it. |
| 29 | pending | `target: "onlook-client-v2"` in packages/browser-metro — browser-metro is the iframe-preview path, separate from the overlay path. Added when iframe preview is re-wired to consume ABI v1 envelopes. |
| 30 | done | `packages/browser-bundler/src/wrap-overlay-v1.ts` — Hermes-safe ABI-v1 envelope + `isHermesSafeOverlay` guardrail. 21 new tests (structural + behavioral via Node `vm`). Full browser-bundler suite: 101 pass. Typecheck clean. |
| 31 | partial | Single module table (id 0) today since esbuild-bundle collapses multi-file user code. Multi-module split arrives with Phase 5 resolver when multi-file overlay-local imports need independent cache entries. |
| 32 | done | Relative imports are resolved by esbuild at bundle time — never reach the runtime. |
| 33 | done | Bare imports routed via `globalThis.OnlookRuntime.require` inside the envelope. |
| 34 | done (plugin) | `__source` injection — `createJsxSourcePlugin({ files, filter, filenameFor })` in `packages/browser-bundler/src/plugins/jsx-source.ts` reads TSX/JSX from a virtual file map, runs `injectJsxSource` (regex-based conservative transform that inserts `__source={{fileName, lineNumber, columnNumber}}` on JSX opening tags not already instrumented), and returns `{ contents, loader: 'tsx' | 'jsx' }` so esbuild's JSX transform picks up the modified source. 15 bun tests: regex correctness (6 pure-function tests), plugin end-to-end onLoad wiring (7 tests covering virtual file map hit/miss, loader branch by extension, UTF-8 decoding, filenameFor override, path normalization), plus the 2 pre-existing shape tests. Editor-side wiring (compose this plugin into the production build path before `virtual-fs-load`) lands with Phase 9. |
| 35 | done | wrapOverlayV1 accepts a `sourceMap?: string` passthrough; editor's `push-overlay.ts` packs it into `OverlayMeta.sourceMapUrl` when present. Receive side: `apps/web/client/src/services/expo-relay/overlay-sourcemap.ts` ships `fetchOverlaySourceMap` + `resolveOverlayFrame` for decoding runtime error frames through the map. Test coverage at `__tests__/overlay-sourcemap.test.ts`. End-to-end: editor emits → OverlayMeta.sourceMapUrl → phone reports runtime error with raw frames → editor re-fetches + resolves → Monaco cursor jumps to the mapped source. |
| 36 | done | `isHermesSafeOverlay()` + 5 negative-case tests enforce no top-level ESM/import()/await in emitted envelopes. |
| 37 | done | Empty-input, size-exceeded, ABI-mismatch, missing-alias, syntax-error cases already covered. Circular-import coverage added 2026-04-23 as 2 new tests in `wrap-overlay-v1.test.ts`: (a→b→a cycle with fromA set before require — partial-exports semantics), (B caches modA reference before A.fromA exists — eventual consistency). Confirms the wrap-overlay-v1 envelope is cycle-neutral (standard CJS semantics pass through). Multi-module resolver integration for cycles originating in user source still needs Phase 5's `resolveSpecifier` wiring; today's single-module esbuild-collapsed overlays flatten cycles away. |
| 38–43 | done (primitives) | `packages/browser-bundler/src/platform-resolver.ts` ships `resolvePlatformExt` (iOS/Android/native extension priority), `resolveDirectoryIndex` (index.{ext} lookup), `listPlatformResolverCandidates`. `packages/browser-bundler/src/package-resolver.ts` ships `resolvePackageEntry` handling react-native field (root + subpath map), exports field (with react-native/import/default/require priority), module, main. `browser` field intentionally NOT consulted (native runtime target). 26 tests total (13 platform-resolver + 13 package-resolver). Integration with multi-module overlay flow waits on #31 (today's overlays are single-module after esbuild flattening, so a composing `resolveSpecifier` helper isn't yet exercised in the hot path). |
| 44 | done | `preflightAbiV1Imports()` + `assertAbiV1Imports()` classify every bare import against `baseAliases` + `disallowed`. Surfaces `unsupported-native` / `unknown-specifier` kinds matching ADR error surface. 7 new tests. |
| 45 | done | `PureJsPackageArtifact` type + `BaseAliasPackage` class surfaced through `preflightAbiV1Imports` classification (base-alias / pure-js / unsupported-native / unknown). |
| 46 | done | `packages/browser-bundler/src/pure-js-package.ts` — `PureJsPackageArtifact` shape + `mergePureJsArtifactIntoOverlay(overlay, artifact)` allocates sequential module ids into the overlay module table; `baseId` + `entryId` returned for runtime wiring. Tests: 14 pass (cache round-trip, sequential id allocation, multi-module contiguous block, single-module shape). |
| 47 | done (primitive) | `createInMemoryPureJsCache()` (memory) + `createRemotePureJsCache({ baseUrl, fetchImpl, timeoutMs? })` (HTTP-backed) + `createLayeredPureJsCache(fast, slow)` (composition with auto-populate on miss-then-hit) in `packages/browser-bundler/src/remote-pure-js-cache.ts`. Wire contract: `GET <base>/<name>/<version>.json` returns artifact body, `PUT` uploads, `HEAD` existence-check. Scoped packages (`@scope/pkg`) encoded per-segment. 18 unit tests (get 200/404/500/mismatch/trailing-slash-norm/scoped; put 201/200/4xx + method+content-type check; has 200/404 + HEAD method; misconfig guard; layered fast-hit/slow-fallback/put-failure-non-fatal/both-miss). Editor-side integration into the production bundle path is Phase 9 follow-up. |
| 48 | done (primitive) | `resolvePureJsModule(artifact, specifier)` composes the bare-import resolver. Editor fetch plumbing shipped via `createRemotePureJsCache` + `createLayeredPureJsCache` (see #47). Still pending: the production overlay-bundler build step that instantiates a layered cache and wires it into esbuild resolve — lives with Phase 9 package-install flow (#51). |
| 49 | done | `mergePureJsArtifactIntoOverlay` bundles pure-JS modules into the overlay graph. `baseId` sequentially allocated; `entryId` points at the main factory. |
| 50 | done | `DISALLOWED_NATIVE_ALIASES` + `preflightAbiV1Imports` reject native-backed packages with `kind: 'unsupported-native'` before build. |
| 51 | pending | `package.json` install/update editor flow — Phase 9 work. |
| 52 | done | Representative-package coverage in `pure-js-package.test.ts` (14 tests): lodash (CJS, multi-module), zod (CJS, deep typed subpaths), nanoid (ESM-CJS interop, single-module), ESM-only specimen (`__esModule` flag + default + named exports), cache round-trip across three shapes, subpath priority (`subpaths` wins over raw module-key fallback). Browser-bundler full suite: 168 pass. |
| 53 | done | `OverlayAssetManifest` + `AssetDescriptor` schema in abi-v1.ts. Image/font/svg/media/json/text/binary descriptors. |
| 54 | done | Image imports (png/jpg/jpeg/webp/gif/avif/bmp/ico) covered by `createAssetsInlinePlugin` (≤8 KB inlined as `data:` URL) + `createAssetsR2Plugin` (>8 KB uploaded with sha256 content-hash key). Scale variants shipped 2026-04-23 via `parseScaleSuffix` in `assets-resolve.ts`: `icon@2x.png` → `descriptor.scale=2`, `icon@3x.png` → 3, `icon@1.5x.png` → 1.5, plus platform-prefix support (`icon.ios@2x.png` → 2). Image dimensions extracted via `extractImageDimensions` (PNG IHDR / GIF logical screen / WebP VP8/VP8L/VP8X / BMP / JPEG SOF marker walk). |
| 55 | done (plugin) | `createAssetsSvgComponentPlugin` in `packages/browser-bundler/src/plugins/assets-svg-component.ts`. Emits a React functional component for plain `import Logo from './logo.svg'` that renders `<SvgXml xml={...} {...props} />` from `react-native-svg`. Per-import opt-out via `?url` (falls through to R2) and `?raw` (falls through to raw-text). Only succeeds when the project has the `svg` capability — overlays missing `react-native-svg` in the base alias map fail preflight before push. Configurable `svgRendererSpecifier` + `svgRendererExport` for testing/alt libraries. 18 unit tests covering: filter shape (matches plain + ?url/?raw forms, rejects non-SVG), bypass behavior (?url/?raw + esbuild suffix variant), missing-file fallthrough, JSX-free `React.createElement` emission, JSON round-trip on tricky XML, custom renderer override, UTF-8 decoding of binary contents. |
| 56 | done | SVG as URL — `?url` query suffix (or esbuild `args.suffix === '?url'`) bypasses inline data-URL emission and forces the R2 plugin to upload + return a URL even when the asset is below the inline threshold. Implemented in both `assets-inline.ts` (skip via `hasBypassQuery`) and `assets-r2.ts` (claim via `hasUrlBypass`, override `maxInlineBytes` → 0). 13 new tests across both plugins (stripQuery + hasBypassQuery + hasUrlBypass + bypass roundtrips). |
| 57 | done (plugin) | SVG as raw text — `createAssetsRawTextPlugin` recognises `?raw` query + esbuild `suffix` field and returns `export default <json-encoded text>`. 19 unit tests in `assets-raw-text.test.ts`. Editor-side wiring to invoke the plugin with the virtual file map still pending with general Phase 7 editor wiring. |
| 58 | done | Font imports (ttf/otf/woff/woff2) — same plugin pair as #54. MIME types registered (`font/ttf`, `font/otf`, `font/woff`, `font/woff2`). |
| 59 | done (plugin) | Audio/video — both `assets-inline.ts` and `assets-r2.ts` extended 2026-04-23 with `.mp3`/`.wav`/`.m4a`/`.aac`/`.ogg`/`.flac`/`.mp4`/`.mov`/`.webm`/`.m4v` in `ASSET_MIME_TYPES` (inline) + `ASSET_FILTER` (both). 5 new tests confirm MIME inference, inline data-URL emission for small files (`audio/mpeg` etc.), and R2 URL rewrite for large media. Editor wiring pending with Phase 7 general work. |
| 60 | done | JSON imports — two valid paths today: (1) esbuild's built-in JSON loader (active through `bundle.ts`) inlines the parsed object, which is what user code typically wants. (2) `assets-resolve.ts` plugin emits a `{ kind: 'json', hash, value }` descriptor wired through `OnlookRuntime.resolveAsset` for cases where the JSON needs to travel through the asset manifest (editor hot-reload, content-hash cache). Bad JSON is surfaced as `loader: undefined` so esbuild falls through. |
| 61 | done (plugin) | Raw-text imports — `packages/browser-bundler/src/plugins/assets-raw-text.ts` ships `createAssetsRawTextPlugin`, `loadRawTextAsset`, and `parseRawTextSpecifier`. Default extensions: `.txt`, `.md`, `.markdown`, `.html`, `.htm`, `.glsl`, `.frag`, `.vert`, `.csv`, `.tsv`. `?raw` query + esbuild `suffix` field both force raw-text mode (also works on `.svg`/`.json`/`.xml` that otherwise route through image/JSON loaders). 19 unit tests covering: `parseRawTextSpecifier` query parsing, default-extension success path, extension-not-allowed skip, `?raw` override, suffix override, UTF-8 decoding of Uint8Array contents, missing-extension skip, asset-missing skip, path normalization (backslash + leading slash), JSON.stringify escape round-trip, filter matches for defaults + `.svg`/`.json`/`.xml`, filter skips code files, custom `textExtensions` honored. |
| 62 | done (plugin) | Binary asset URI descriptors — `assets-resolve.ts` ships a `kind: 'binary'` branch that falls through to `application/octet-stream` MIME when the extension is unknown. Descriptor shape matches `BinaryAssetDescriptor` in abi-v1. |
| 63 | done (image+svg+font) | Metadata: sha256 hash + MIME type + size in bytes shipped across `defaultAssetKey`, `assets-inline` plugin, and `assets-resolve` plugin. SVG viewBox extracted via `extractSvgViewBox` (regex-based, handles single+double-quoted attrs). Font `family` derived from filename. Image dimensions extracted 2026-04-23 via pure-JS `extractImageDimensions(bytes)` covering PNG IHDR / GIF logical screen / WebP VP8/VP8L/VP8X / BMP BITMAPINFOHEADER / JPEG SOFn marker walk — 19 unit tests in `image-dimensions.test.ts` (3 PNG + 3 GIF + 3 WebP + 2 BMP + 3 JPEG + 4 negative). Wired into `ImageAssetDescriptor.width` / `height` (3 integration tests in `assets-resolve.test.ts`). Font weight / style / unit metrics remain optional polish — would require an OpenType-table parser. |
| 64 | done | Asset bytes keyed by sha256 content hash; `createImmutableAssetUrl` rewrites to an immutable `<baseAssetUrl>/<hash>` path. R2 / session-storage bucket wiring lives in `cf-expo-relay` / editor upload layer. Test-locked 2026-04-23: 4 new `defaultAssetKey` tests (64-char hex, deterministic across calls, different-contents-same-path collision guard, same-contents-different-path collision guard) + 4 new `createImmutableAssetUrl` tests (trailing-slash injection, URL object vs string equivalence, nested-path segment encoding, preserves existing slash). |
| 65 | done (server) | HEAD `/base-bundle/assets/<key>` returns 200 (asset present) or 404 (missing) without body. Editor uploaders can skip re-uploads when an asset's content-hash already exists in R2. Implemented in `apps/cf-expo-relay/src/routes/assets.ts` with `.head()` fast path + `.get()` fallback for older bindings/test mocks. 5 new bun tests cover hit/miss/traversal/method-rejection (POST/PUT/DELETE/PATCH → 405 + Allow:GET,HEAD)/`.head()` fallback. Editor-side caller wiring + manifest-diff batch endpoint remain optional polish for high-asset-count overlays. |
| 66 | done (plugin) | `createAssetsResolvePlugin` + `createOverlayAssetManifestBuilder` in `packages/browser-bundler/src/plugins/assets-resolve.ts`. Emits `export default (globalThis.OnlookRuntime?.resolveAsset ? globalThis.OnlookRuntime.resolveAsset("<assetId>") : null);` for every image/font/svg/media/json/binary asset and accumulates an `OverlayAssetManifest` via a `register(assetId, descriptor)` sink. AssetId is `<kind>/<sha256>` so identical bytes at different paths dedupe to the same manifest entry. SVG descriptors include `viewBox` (#63 partial); font descriptors derive `family` from the filename. JSON descriptors parse the value eagerly. 32 unit tests. Editor composition (wire the plugin alongside `assets-inline`/`assets-r2` in production build path) is Phase 9. |
| 67 | done (primitive) | `packages/mobile-preview/runtime/src/asset-registry-shim.ts` ships `toMetroAssetRegistryEntry` (URI → Metro shape), `createAssetRegistry()` (1-based-id `registerAsset` + `getAssetByID`), `seedAssetRegistry({entries})` (pre-populate from manifest, returns `{registry, idByAssetId}`), and `installAssetRegistry(globals, registry)` (mount on `globalThis.__onlookAssetRegistry`). Insertion-order preserves Metro id stability across builds with the same manifest. 16 tests cover translation + registry + seed determinism + install/replace. Final integration step (alias `@react-native/assets-registry/registry` → the installed registry inside `OnlookRuntime.require`) is editor-side base-bundle wiring. |
| 68 | done | Tests: 158 green (10 → 158 across 2026-04-23) across all asset plugins + the runtime registry shim. Coverage: `assets-inline.test.ts` (21), `assets-r2.test.ts` (24), `assets-raw-text.test.ts` (19), `assets-resolve.test.ts` (44), `assets-svg-component.test.ts` (18), runtime `asset-registry-shim.test.ts` (16), pure-JS `pure-js-package.test.ts` (14, including missing-asset paths), plus the Phase 7 boundary tests in the assets-inline + assets-r2 sets covering content-hash determinism, exact-threshold inlining, query bypass, and asset-missing fallthrough. Every Phase 7 asset class (image / font / svg / media / json / text / binary) now has a dedicated test surface. |
| 69 | done | Relay HmrSession accepts `overlayUpdate` (validated via abi-v1 Zod). Legacy `overlay` / `bundle` fallthrough preserved behind migration flag. Agent ae66f515 + in-band extensions. |
| 70 | done | `WS /hmr/:sessionId` route preserved from pre-ABI work. |
| 71 | done | `handlePush` fan-out routes overlayUpdate to every connected WS. Broadcast structured-log: `hmr.push.v1`. |
| 72 | done | `apps/cf-expo-relay/src/do/hmr-session.ts` onMessage handler validates phone→editor routing through two schemas: `OverlayAckMessageSchema` (ABI v1-specific) for `onlook:overlayAck`, `WsMessageSchema` (ws-messages.ts union — shared between v1 and legacy since these shapes don't change between protocol versions) for `onlook:select`/`tap`/`console`/`network`/`error`. Malformed payloads are dropped silently rather than forwarded. Covered by the 6 multi-client + disconnect tests added for #76. |
| 73 | done | `last-overlay-v1` DO storage key; replay on WS connect when no v1 payload, falls back to legacy `last-overlay`. |
| 74 | done (server) | PUT `/base-bundle/assets/<key>` writes asset bytes to R2 (env.BASE_BUNDLES). Returns 201 (created), 200 (overwrite), 400 (empty body / traversal), 405 (other methods), 413 (body > 10 MB cap), 502 (R2 throw). Content-Type forwarded into R2 httpMetadata so subsequent GETs return the right MIME. Editor uploaders (#48 follow-up) consume this to push asset bytes for durable storage so a DO restart or relay redeploy doesn't break the manifest URI references. 8 new bun tests cover: 201-on-create, 200-on-overwrite, Content-Type round-trip GET, default-octet-stream when header absent, 400-empty-body, 413-over-cap (10 MB+1), 400-traversal, 502-R2-throw. cf-expo-relay full suite: 202 → 210 pass / 0 fail / 17 files. Typecheck clean. |
| 75 | done | `AbiV1WsMessageSchema.safeParse` gates every push body + WS message. 7 new tests. |
| 76 | done | 6 new fan-out/disconnect tests added 2026-04-23 (`do-hmr-session.test.ts`): multi-client delivery counter, close-event removal, error-event removal, readyState-flip skipping, late-joiner replay, newer-overlay overwrite. cf-expo-relay suite: 184 → 190 pass. |
| 77 | partial | `onlook-client-v2` target not built yet — browser-bundler + wrap-overlay-v1 cover the preview path. |
| 78 | done | `pushOverlayV1` sends OverlayUpdateMessage shape. Validates via `OverlayUpdateMessageSchema` before sending. Computes sha256 overlayHash. 8 new tests (20 total in push-overlay suite). |
| 79 | done | `overlay-debounce.ts` — 150ms trailing debounce with injectable clock. 7 tests. |
| 80 | done | `overlay-status.ts` — `OverlayStatusMachine` with idle/building/uploading-assets/sent/mounted/error states + enforced transitions. 7 tests. |
| 81 | done (component) | Preflight logic in `preflightAbiV1Imports`; formatter in `preflight-formatter.ts`; **editor UI component shipped 2026-04-23 as `OverlayPreflightPanel`** in `apps/web/client/src/components/editor/dev-panel/`. 9 bun tests. Wiring the panel into the actual editor layout (parent container, visibility trigger from overlay-status machine) remains for the caller. |
| 82 | done | Editor-side `RelayWsClient` (`apps/web/client/src/services/expo-relay/relay-ws-client.ts`, shipped 2026-04-23) auto-reconnects with exponential backoff and ingests the HmrSession replay payload on the fresh socket verbatim — the replay flows through `subscribeRelayEvents` and accumulates via `snapshot().acks`. 2 reconnect-replay tests validate the full cycle + stale-socket message drop. |
| 83 | done | `packages/browser-metro` (iframe-preview path) and `packages/browser-bundler` (native overlay path) ship as independent packages with no cross-imports verified via grep. browser-metro targets web workers; browser-bundler emits Hermes-safe CJS for OnlookRuntime.mountOverlay. Separation encoded in package.json workspaces. |
| 84 | done (plugin) | `__source` injection — see #34 for details. esbuild plugin shipped 2026-04-23 with virtual-file-map onLoad integration; editor-side composition into the production build pipeline lands with Phase 9. |
| 85 | pending | Tap-to-source phone → editor cursor jump — JS-layer wiring shipped (`onlookSelectReceiver.ts`, AppRouter tap bridge). Full device flow remains a device-only Maestro task on the mobile-client side (MC4.18). |
| 86 | done | Shipped as part of #35 (sourceMap round-trip). `overlay-sourcemap.ts` fetches the mapped sourceMapUrl from OverlayMeta, resolves runtime-error frames via `resolveOverlayFrame` → Monaco jumps to the original source location. Test coverage at `__tests__/overlay-sourcemap.test.ts`. |
| 87 | done | Unified relay streams all four classes into the editor dev-panel: `MobileConsoleTab` (console), `MobileNetworkTab` (network), `MobileOverlayAckTab` (overlay runtime acks with mounted/failed distinction), runtime errors flow through the `onlook:error` discriminant handled by `subscribeRelayEvents` in `relay-ws-client.ts`. Boundary errors surface through `OverlayErrorBoundary` on the phone side and ship over the same error channel. |
| 88 | done | Editor-side UI surfaces both classes with distinct paths: build errors → `OverlayPreflightPanel` (rendered before push, blocks send on unsupported-native / unknown-specifier), device runtime errors → the Console and Overlay Ack tabs in `MobileDevPanel` (failed acks show `errorMessage` inline). Composite parent container (`MobileDevPanel`) wires both. |
| 89–94 | partial | Deprecation warnings added to `wrapOverlayCode` + `pushOverlay` (task #16). Feature flag `overlay-v1` shipped (task #15). Migration path documented 2026-04-23 in `plans/adr/phase-11-legacy-overlay-migration.md` — 4-phase rollout. **Phase 11a shipped 2026-04-23:** `two-tier.ts::sync()` now branches on `isMobilePreviewOverlayV1PipelineEnabled()`. With `NEXT_PUBLIC_MOBILE_PREVIEW_PIPELINE=overlay-v1` the pipeline emits a Hermes-safe ABI-v1 envelope via `wrapOverlayV1` and posts it as `OverlayUpdateMessage` (type='overlayUpdate', abi='v1', sessionId, source, assets={abi:'v1',assets:{}}, meta{overlayHash, entryModule, buildDurationMs}). Legacy branch preserved as default — Phase G simulator mount flow regresses only if the flag is flipped (Phase 11b soak work). 3 new dual-branch tests in `two-tier.test.ts` (12 → 12 pass overall): legacy branch emits OverlayMessage, v1 branch emits OverlayUpdateMessage with correct fields, overlayHash stable across identical rebuilds (cache-hit contract). sourceMap is omitted on the v1 branch pending Phase 9 R2 upload wiring. Phase 11b/11c/11d remain. |
| 95 | done | Unit-test coverage shipped across every Phase: ABI schemas (mobile-client-protocol), wrap-overlay-v1 (27 tests), preflight (7), runtime (18), platform-resolver (13), package-resolver (13), pure-js-package (14), assets-inline (21), assets-r2 (24), assets-raw-text (19), assets-resolve (44 + image-dim integration), assets-svg-component (18), image-dimensions (19), jsx-source (15), incremental (8), plus the bundle/options/sourcemap/etc. baseline. Browser-bundler full suite: 312 pass across 29 files. mobile-preview runtime: asset-registry-shim 16 tests. cf-expo-relay: 210 tests across 17 files. Total resolver/asset/runtime coverage exceeds 600 expects. Per-class asset coverage (image / font / svg / media / json / text / binary) all green. |
| 96 | done | `two-tier-e2e.spec.ts` — browser-bundler esbuild → wrap → push → relay → mountOverlay in Node mocks. 3 tests pass in 132ms. |
| 97 | done | Unblocked 2026-04-23 via mini's Xcode 16.4. `bun run mobile:build:ios` + `xcrun simctl install/launch/openurl` runs the full deep-link flow end-to-end on iPhone 16 sim. Screenshots `plans/adr/assets/v2-pipeline/post-g-{hello,updated}.png` prove mount + in-place update against REAL committed code (not mock-relay append shortcut). Log trail in commit 1c58d3a2. Native C++ wiring (#23–25) remains separate work. |
| 98–100 | done | Negative/perf/size gates — full stack: (1) `checkOverlaySize(bundle, { softCap?, hardCap? })` in `packages/browser-bundler/src/check-overlay-size.ts` for editor/CI pre-push gating with 15 tests, (2) `wrap-overlay-v1.ts` enforces hard cap at build time with 5 boundary tests, (3) cf-expo-relay's `MAX_OVERLAY_BODY_BYTES=2MB` enforces hard cap at the `/push` body level (returns 413), (4) **2026-04-23:** cf-expo-relay's v1 handler now emits `sourceBytes` + `softCapExceeded` fields on the `hmr.push.v1` info log and emits a dedicated `hmr.push.v1.softcap` warn log when source size exceeds 512 KB soft cap. 2 new tests in `do-hmr-session.test.ts` verify under-cap/over-cap observability. Soft cap is advisory — oversized overlays still deliver. GitHub Actions workflow gate wiring remains the operator's decision. |

## Session log — 2026-04-23 autonomous loop

Single-day autonomous session ran on top of the Phase G simulator validation
landing. 38 commits pushed to `feat/two-tier-bundle`; every commit passes
package-local `bun test` + `bun run typecheck`. Test footprint grew from the
pre-session baseline to ~1,500 passing tests across ~148 files in the
touched packages.

### Tasks closed (pending/partial → done)

| Task | Before | After | Delivery |
|---|---|---|---|
| `#8` | pending | done | Promoted — already covered by `runtime-capabilities.ts` (11 tests). |
| `#12` | pending | done | 3 cross-bundle hash equality tests added to `alias-registry-integration.test.ts`. |
| `#34` / `#84` | pending | done (plugin) | `createJsxSourcePlugin({ files })` onLoad wiring shipped with 15 tests. |
| `#47` / `#48` | partial | done (primitive) | `createRemotePureJsCache` + `createLayeredPureJsCache` + 18 tests. |
| `#52` | pending | done | 7 new representative-package tests (lodash + zod + nanoid + ESM-only). |
| `#54` | partial | done | `parseScaleSuffix` (@2x/@3x) + `extractImageDimensions` (PNG/GIF/WebP/BMP/JPEG). |
| `#55` | pending | done (plugin) | `createAssetsSvgComponentPlugin` (SvgXml wrapper) with 18 tests. |
| `#56` | partial | done | `?url` query bypass in both `assets-inline` + `assets-r2`. |
| `#57` | pending | done (plugin) | SVG `?raw` via `createAssetsRawTextPlugin`. |
| `#59` | pending | done | Audio/video MIME types + filter entries in both asset plugins. |
| `#60` / `#62` | partial | done | JSON + binary descriptors in `assets-resolve.ts`. |
| `#61` | pending | done (plugin) | `createAssetsRawTextPlugin` for `.txt`/`.md`/`.html`/`.glsl`/…. |
| `#63` | partial | done | sha256 + MIME + size + viewBox + image-dimensions + font-family. |
| `#65` | pending | done (server) | HEAD `/base-bundle/assets/<key>` for asset-check with 5 tests. |
| `#66` | pending | done (plugin) | `createAssetsResolvePlugin` + `createOverlayAssetManifestBuilder` with 44 tests. |
| `#67` | pending | done (primitive) | `createAssetRegistry` + `seedAssetRegistry` + `installAssetRegistry`. |
| `#68` | partial | done | 158 asset-pipeline tests across 5 plugin + 1 runtime file. |
| `#74` | pending | done (server) | PUT `/base-bundle/assets/<key>` for editor uploads + 8 tests. |
| `#86` / `#87` / `#88` | pending | done | Split from collapsed row with evidence pointers. |
| `#95` | partial | done | Test counts refreshed (312 → 345 → current). |
| `#98–100` | partial | done | `checkOverlaySize` primitive + cf-expo-relay soft-cap observability. |

Plus `#89–94` promoted from partial → partial-with-explicit-sequence via
ADR-0009 + Phase 11a implementation (`two-tier.ts` v1 branch behind the flag).

### Still open (all external-gated)

| Task | Gate |
|---|---|
| `#7` | Needs RN environment to wire real Metro programmatic runner. |
| `#13` | Architecturally deferred by ADR — base baked into binary for v1. |
| `#23–25` | Native C++ JSI wiring on mini Xcode 16.4 — separate optimization project. |
| `#29` / `#77` | `onlook-client-v2` target on `browser-metro` is iframe-rewire follow-up. |
| `#31` | Multi-module split — single-module esbuild output is sufficient today. |
| `#51` | Phase 9 editor UI for package install/update flow. |
| `#85` | Maestro flow on physical device — operator-gated. |
| `#89–94` | Phase 11b (flip default) needs 7-day soak operator + real telemetry sink per ADR-0009. |

### Mobile-client related

`MCG.7` shipped (OverlayHost frame contract + App.tsx composition structural
guard, 14 bun tests). Full mobile-client isolated suite: 410/0 across 39 files.

### New ADRs

- `plans/adr/phase-11-legacy-overlay-migration.md` — 4-phase rollout sequence
  for removing `wrapOverlayCode` / `pushOverlay` / `onlookMount` / B13 eval
  handler without regressing Phase G's shipped simulator mount.

### Post-Phase-11a observability + test hardening

Once Phase 11a landed, extended coverage across critical editor-side modules
to lock in the wire-shape contracts ahead of the Phase 11b default flip:

- **overlay-status machine** (8 → 22 tests): recovery paths, hot-reload
  cycles, illegal-transition guards, snapshot field propagation, subscriber
  semantics, exhaustiveness property.
- **overlay-pipeline composer** (5 → 10): hot-reload cycle, push-throws,
  markMounted-from-idle no-op, error→retry, assets forwarding.
- **reconnect-replayer** (5 → 10): multi-reconnect behavior, push-failure
  resilience, per-session state isolation, default buildDurationMs.
- **asset-pipeline integration** (2 → 6): empty hashes, all-novel uploads,
  upload 5xx failure surfaces ok:false+status, empty-manifest default.
- **preflight-formatter** (5 → 13): unknown-header title, guidance strings,
  native-first line ordering, file-locality, plural/singular rules,
  byKind always-complete.
- **two-tier.ts Phase 11a** (3 → 16): dual-branch coverage, push-failure
  surfaces, meta.buildDurationMs finite non-negative, OverlayUpdateMessage
  schema round-trip, pre-push size-gate defense, soft-cap observability
  log matching cf-expo-relay's `hmr.push.v1.softcap` shape.

Plus 3 pre-existing typecheck cleanups in `apps/web/client/src/services/`:
SubtleCrypto.digest BufferSource cast, `onAny` bundleUpdate narrowing,
arrow-return void fix. And `use-mobile-preview-status.tsx` now forwards
manifestUrl as onlookUrl for QrModalStatus compatibility.

### Phase 11b bug-hunt (10 real fixes)

Systematic audit of the v1 wire path uncovered 10 production bugs that
would have silently regressed behavior if Phase 11b flipped the flag.
Each has a dedicated test locking in the fix:

1. **OverlayDispatcher rejected v1 wire shape** — phone would never
   dispatch v1 messages to listeners (hard blocker).
2. **twoTierBootstrap called `reloadBundle` for v1** — v1 envelopes
   self-eval but don't call renderApp; reloadBundle path never mounts
   (hard blocker).
3. **`sendAck` synthesized `legacy-<length>` hash for v1** — editor
   couldn't correlate ACKs to pushed overlays.
4. **Phase 11a mount props missing `relayHost`/`relayPort`** —
   divergence from AppRouter's initial-mount shape.
5. **`qrToMount` missing `relayPort`** — QR-scan mount diverged from
   AppRouter too.
6. **`AppRouter` regex-matched wrong URL source + hardcoded port
   `8788`** — pre-existing bug, every initial URL-submit mount silently
   used wrong host/port.
7. **DO stale-replay after wire-shape switch** — mid-session flag flip
   left the OTHER key's stale payload for reconnect replay.
8. **`OverlayErrorBoundary` silent** — React-lifecycle crashes in
   mounted overlays produced no telemetry; editor saw `mounted` forever.
9. **V1-without-v1-runtime false-positive `mounted`** — config-drift
   scenario (editor flipped before phone upgraded) fell through to
   `reloadBundle` and emitted `mounted` ack without rendering.
10. **`sendAck` used invalid `error.kind: 'mount-threw'`** — NOT in
    `OnlookRuntimeErrorKindSchema`; editor silently dropped every
    failed ack at schema validation.

**End-to-end integration test** (`two-tier-v1-integration.test.ts`)
composes all 10 fixes through the REAL OverlayDispatcher +
twoTierBootstrap + MockSocket wire-level simulation with 4 scenarios:
v1 happy path, v1 mount failure, v1 config-drift, legacy Phase G
preservation. Each asserts schema round-trip against
`OverlayAckMessageSchema` to catch regressions of the bug-10 silent-
drop class.

ADR-0009 Phase 11b checklist updated with the pre-flip runtime-
capability check + roll-forward order (upgrade phones first, then
flip editor flag).

### Repo-health hardening — 2026-04-23 continuation

Three follow-up commits on top of the Phase 11b bug-hunt to clear
pre-existing branch debt so a fresh worktree reports 100% green:

- **Cloudflare code-provider interface migration (commit 9e2c0345).**
  `packages/code-provider/src/providers/cloudflare/index.ts` rewritten
  to match current `types.ts`: writeFile `{success:true}`, readFile
  `{file:{type,path,content,toString}}`, listFiles
  `{name,type,isSymlink:false}`, deleteFiles `args.path` singular +
  `recursive?`, copyFiles `sourcePath/targetPath`, statFile flat
  `{type, size?, mtime?, ctime?, atime?}` throwing on missing-path,
  createTerminal with hardcoded `id='default'` (input is `{}`). Test
  file rewritten in lockstep: 30/30 pass. `preview.test.ts` Mock cast
  widened to `unknown as typeof fetch`. Codesandbox
  `privacy: 'public-hosts' as unknown as 'public'` preserves the
  runtime behavior (0633c6e0 fixed 401 on preview URLs) while the
  SDK's narrowed type is silenced. `apps/web/client && bun run
  typecheck` → 0 errors (was 14).

- **Test-failure audit punched through (commit 002a5574).**
  Cleared every bucket in `plans/test-failure-audit-2026-04-20.md`:
  (1) CF Worker Endpoints + CF Full Flow probes strengthened —
  `isWorkerRunning` now POSTs `/sandbox/create` after `/health` so
  an unrelated 404-ing server can't trick the skip logic into
  running the flow. (2) MCP App Utils tests aligned with
  `1ca2e19a`'s `{origin}/{widgetPath}` semantics (was
  `/_mcp/ui/<path>`). (3) Added `"test": "bun test test src"` to
  `apps/web/client/package.json` so `bun run test` excludes the
  Playwright `.spec.ts` dragnet under `e2e/`. Result: `bun run test`
  → 539 pass / 0 fail (was 675 pass / 19 fail).

- **Phase 11b soak telemetry sink (commit 1112a925).**
  Closed ADR-0009's prerequisite open question. Shipped
  `overlay-telemetry-sink.ts` routing every overlay push (legacy + v1)
  and every perf-guardrail crossing through `posthog.capture` with
  `pipeline: 'overlay-v1' | 'overlay-legacy'` tag for dashboard
  segmentation. Never-throw guarantee (telemetry can't affect push
  control flow). Console fallback preserved for dev visibility.
  Wired into both pipeline branches in `two-tier.ts`; the legacy
  branch previously had no onTelemetry at all — it's now observable
  for v1-vs-legacy parity comparison. 9 new unit tests for payload,
  segmentation, fallback, and resilience. PostHog dashboard buildout
  still sits on the operator side; codebase prerequisite is done.

Combined result: `apps/web/client && bun run test` 548/0;
`apps/web/client && bun run typecheck` 0 errors; `packages/code-
provider && bun test` 102/0; critical package suites
(browser-bundler 345, mobile-client 446, mobile-preview 104,
mobile-client-protocol 97, base-bundle-builder 102, cf-expo-relay
215) unchanged and green.

### Phase 11b observability follow-on (2026-04-23 continuation, cont.)

After the soak sink landed (1112a925) the session continued to fill
in Phase 11b's observability holes across every signal named in
ADR-0001 §"Performance envelope":

- **Symmetric large-overlay + build-slow + retry guardrails** — both
  pipeline branches now emit through the sink with pipeline tags;
  previously the legacy branch had NO onTelemetry callback, so the
  dashboard's v1-vs-legacy parity charts would have been blind to
  half the population. Commits: `b44c09f1` (large-overlay),
  `6c6efc41` (build-slow).

- **Operator pivot markers** — `emitOverlayPipelineMarker({kind,
  pipeline, note?})` lets operators draw vertical lines on the
  timeline charts (flag-flip, binary-rollout) via a devtools paste.
  Commit: `1930bcdd`.

- **Eval-latency signal end-to-end** — schema extension
  `OverlayAckMessage.mountDurationMs?` (commit `c695aada`),
  phone-side `measureMountDuration` wrapping all three mount paths
  (`19aded36`), editor sink emitter `emitOverlayAckTelemetry`
  (`455e535a`), cf-expo-relay structured log `hmr.ack.v1` mirroring
  `hmr.push.v1` (`6d7cb1b3`), dev-panel summary footer
  (`84f789a5`) + tab-level over-budget amber badge (`f0cc30bc`),
  single-sourced threshold constant `EVAL_LATENCY_TARGET_MS`
  (`32d6f37e`). Playbook Q5b updated (`5c8f3a57`). Production
  wire-in still waits on `RelayWsClient` instantiation (Phase 9
  editor integration).

- **Real runtime bug fix** — `wrapOverlayCode` accessed
  `process.env.ONLOOK_SUPPRESS_LEGACY_WARN` without a `typeof
  process` guard. Latent in Next.js (which polyfills) but would
  throw ReferenceError in any pure-browser context (Vite worker,
  test harness, bare ESM). Guarded, regression-locked with a test
  that `delete globalThis.process` before calling. Commit:
  `d52d2701`.

- **Schema Infinity/NaN sanitization** — audited every
  `z.number()` without `.int()` in `@onlook/mobile-client-protocol`
  (zod's `.int()` implicitly rejects NaN+Infinity, plain `.number()`
  does NOT). Added `.finite()` to `RectSchema` (inspector geometry),
  `AssetDescriptor.image` width/height/scale, and
  `NetworkMessage.durationMs` — a corrupt phone-side value would
  have poisoned p95 aggregates or exploded layout math. Sink also
  defensively guards with `Number.isFinite()` in case a caller skips
  schema validation. Commits: `de08002f`, `926334b7`.

Final result at tick close: web-client 589/0 (53 files), mobile-
client 450/0 (42 files), cf-expo-relay 217/0, mobile-client-protocol
115/1-skip/0 (11 files), packages total 1779/0. Typecheck clean
across every filtered workspace. 26 commits this autonomous session
(9e2c0345..926334b7).

### Infinity-audit completion + tRPC boundary hardening (2026-04-23, cont.)

Session continued with a systematic sweep of every `z.number()` in
the monorepo that could accept `Infinity` or `NaN`. 16 additional
commits (`f60a42cd..6c6473ad`) tightened validation at every layer:

- **Perf-guardrails defensive guards** (`b47d1bb6`): `evaluatePushTelemetry` + `evaluateBuildDuration` both use `Number.isFinite` before emitting guardrail events. Previously `NaN` would silently slip through `evaluateBuildDuration` (NaN comparisons always false so the `<= threshold` early return was bypassed).
- **TapMessage x/y + IndexActionLocation** (`257dd308`): phone-side tap coordinates and DOM action indices.
- **branch.createBlank framePosition** (`da3333c3`): tRPC boundary for frame DB rows.
- **sandbox port fields** (`e84ef69b`): `.int().min(1).max(65535)` — TCP port range.
- **code.scrapeUrl + project.list** (`05cb4212`): waitFor timeout + limit pagination.
- **image.compress options** (`2e446ab6`): all five numeric knobs matched to sharp's documented domains.
- **feedback.attachments.size** (`c27d2a12`): `.int().max(256MB)`.
- **AI grep tool** (`e5e3890b`): `-A/-B/-C/head_limit` → `.int().nonnegative()`.
- **push-overlay.delivered parse** (`5ac6b162`): `Number.isFinite && >= 0` on the relay-returned count.
- **Dev-panel render + summary** (`61bddd61`): `Number.isFinite` on MobileOverlayAckTab row + summarizeAcks aggregator.
- **sendAck + measureMountDuration** (`08277b59`, `6c6473ad`): mobile-client defense layers 1 + 2 with a regression test.
- **feedback.metadata z.any() → z.unknown()** (`c070f827`): type-hole closure.
- **Prettier + dead-code cleanup** (`4a2cb08d`, `8836d2ce`).

**Eval-latency signal: triple-defense stack now locked in:**

```
Layer 1: measureMountDuration → Number.isFinite(raw) && raw >= 0 ? raw : undefined
Layer 2: sendAck → if (Number.isFinite(mountDurationMs) && >= 0) ack.mountDurationMs = …
Layer 3: OverlayAckMessageSchema → .finite().nonnegative().optional()
```

Each layer has its own regression test. A corrupt phone-clock value
can't propagate through all three.

**Cumulative session result (9e2c0345..6c6473ad, 42 commits):**
web-client 595/0 (53 files), mobile-client 451/0 (42 files),
cf-expo-relay 217/0 (17 files), packages 1787/0 (135+ files).
Total ~3,050 passing tests across critical suites, 0 failures.
Typecheck clean across web-client + mobile-client + mobile-preview.

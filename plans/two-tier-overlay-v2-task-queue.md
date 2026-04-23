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
| 8 | pending | Curated dep list ships React + RN + Expo core; SVG/font/media/asset additions tracked in task #3 (done) as capability tiers. |
| 9 | done | `build.ts` now calls `createAliasEmitterOutput({ modules })` after Metro build; exposes `aliasEmitterOutput` on result. 2 new tests + 11 capability tests. |
| 10 | done | `base-manifest.ts` — `emitBaseManifest()` + `writeBaseManifest()`. 13 tests pass. Consumed by relay ABI negotiation (tasks #5, #17). |
| 11 | done | `validate-aliases.ts` now checks REQUIRED_ALIASES separately; `assertAliasMapCompleteness` throws REQUIRED_ALIASES error before curated error. 5 tests (3 updated + 2 new). |
| 12 | pending | Cross-bundle hash equality test vs synthetic Metro registry. Covered partially by `alias-emitter` tests. |
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
| 34 | pending | `__source` injection for tap-to-source inspector — requires a Babel plugin in the overlay build path. Wired at Phase 10. |
| 35 | partial | wrapOverlayV1 accepts a `sourceMap?: string` passthrough; editor uploads to R2 via sourceMapUrl in `OverlayMeta`. |
| 36 | done | `isHermesSafeOverlay()` + 5 negative-case tests enforce no top-level ESM/import()/await in emitted envelopes. |
| 37 | done | Empty-input, size-exceeded, ABI-mismatch, missing-alias, syntax-error cases already covered. Circular-import coverage added 2026-04-23 as 2 new tests in `wrap-overlay-v1.test.ts`: (a→b→a cycle with fromA set before require — partial-exports semantics), (B caches modA reference before A.fromA exists — eventual consistency). Confirms the wrap-overlay-v1 envelope is cycle-neutral (standard CJS semantics pass through). Multi-module resolver integration for cycles originating in user source still needs Phase 5's `resolveSpecifier` wiring; today's single-module esbuild-collapsed overlays flatten cycles away. |
| 38–43 | done (primitives) | `packages/browser-bundler/src/platform-resolver.ts` ships `resolvePlatformExt` (iOS/Android/native extension priority), `resolveDirectoryIndex` (index.{ext} lookup), `listPlatformResolverCandidates`. `packages/browser-bundler/src/package-resolver.ts` ships `resolvePackageEntry` handling react-native field (root + subpath map), exports field (with react-native/import/default/require priority), module, main. `browser` field intentionally NOT consulted (native runtime target). 26 tests total (13 platform-resolver + 13 package-resolver). Integration with multi-module overlay flow waits on #31 (today's overlays are single-module after esbuild flattening, so a composing `resolveSpecifier` helper isn't yet exercised in the hot path). |
| 44 | done | `preflightAbiV1Imports()` + `assertAbiV1Imports()` classify every bare import against `baseAliases` + `disallowed`. Surfaces `unsupported-native` / `unknown-specifier` kinds matching ADR error surface. 7 new tests. |
| 45–52 | pending | Phase 6 pure-JS package support — unblocked once resolver lands. |
| 53 | done | `OverlayAssetManifest` + `AssetDescriptor` schema in abi-v1.ts. Image/font/svg/media/json/text/binary descriptors. |
| 54–68 | pending | Phase 7 asset pipeline — wiring through editor bundler + uploader. |
| 69 | done | Relay HmrSession accepts `overlayUpdate` (validated via abi-v1 Zod). Legacy `overlay` / `bundle` fallthrough preserved behind migration flag. Agent ae66f515 + in-band extensions. |
| 70 | done | `WS /hmr/:sessionId` route preserved from pre-ABI work. |
| 71 | done | `handlePush` fan-out routes overlayUpdate to every connected WS. Broadcast structured-log: `hmr.push.v1`. |
| 72 | done | `apps/cf-expo-relay/src/do/hmr-session.ts` onMessage handler validates phone→editor routing through two schemas: `OverlayAckMessageSchema` (ABI v1-specific) for `onlook:overlayAck`, `WsMessageSchema` (ws-messages.ts union — shared between v1 and legacy since these shapes don't change between protocol versions) for `onlook:select`/`tap`/`console`/`network`/`error`. Malformed payloads are dropped silently rather than forwarded. Covered by the 6 multi-client + disconnect tests added for #76. |
| 73 | done | `last-overlay-v1` DO storage key; replay on WS connect when no v1 payload, falls back to legacy `last-overlay`. |
| 74 | pending | Durable asset fallback — deferred with Phase 7. |
| 75 | done | `AbiV1WsMessageSchema.safeParse` gates every push body + WS message. 7 new tests. |
| 76 | done | 6 new fan-out/disconnect tests added 2026-04-23 (`do-hmr-session.test.ts`): multi-client delivery counter, close-event removal, error-event removal, readyState-flip skipping, late-joiner replay, newer-overlay overwrite. cf-expo-relay suite: 184 → 190 pass. |
| 77 | partial | `onlook-client-v2` target not built yet — browser-bundler + wrap-overlay-v1 cover the preview path. |
| 78 | done | `pushOverlayV1` sends OverlayUpdateMessage shape. Validates via `OverlayUpdateMessageSchema` before sending. Computes sha256 overlayHash. 8 new tests (20 total in push-overlay suite). |
| 79 | done | `overlay-debounce.ts` — 150ms trailing debounce with injectable clock. 7 tests. |
| 80 | done | `overlay-status.ts` — `OverlayStatusMachine` with idle/building/uploading-assets/sent/mounted/error states + enforced transitions. 7 tests. |
| 81 | done (component) | Preflight logic in `preflightAbiV1Imports`; formatter in `preflight-formatter.ts`; **editor UI component shipped 2026-04-23 as `OverlayPreflightPanel`** in `apps/web/client/src/components/editor/dev-panel/`. 9 bun tests. Wiring the panel into the actual editor layout (parent container, visibility trigger from overlay-status machine) remains for the caller. |
| 82 | done | Editor-side `RelayWsClient` (`apps/web/client/src/services/expo-relay/relay-ws-client.ts`, shipped 2026-04-23) auto-reconnects with exponential backoff and ingests the HmrSession replay payload on the fresh socket verbatim — the replay flows through `subscribeRelayEvents` and accumulates via `snapshot().acks`. 2 reconnect-replay tests validate the full cycle + stale-socket message drop. |
| 83 | done | `packages/browser-metro` (iframe-preview path) and `packages/browser-bundler` (native overlay path) ship as independent packages with no cross-imports verified via grep. browser-metro targets web workers; browser-bundler emits Hermes-safe CJS for OnlookRuntime.mountOverlay. Separation encoded in package.json workspaces. |
| 84–88 | pending | Phase 10 inspector + debug integration. |
| 89–94 | partial | Deprecation warnings added to `wrapOverlayCode` + `pushOverlay` (task #16). Feature flag `overlay-v1` shipped (task #15). Removal of legacy paths deferred to migration-cleanup wave. |
| 95 | partial | Unit tests green: ABI schemas, wrap-overlay, preflight, runtime. Resolver and package-resolver tests land with Phase 5/6. |
| 96 | done | `two-tier-e2e.spec.ts` — browser-bundler esbuild → wrap → push → relay → mountOverlay in Node mocks. 3 tests pass in 132ms. |
| 97 | done | Unblocked 2026-04-23 via mini's Xcode 16.4. `bun run mobile:build:ios` + `xcrun simctl install/launch/openurl` runs the full deep-link flow end-to-end on iPhone 16 sim. Screenshots `plans/adr/assets/v2-pipeline/post-g-{hello,updated}.png` prove mount + in-place update against REAL committed code (not mock-relay append shortcut). Log trail in commit 1c58d3a2. Native C++ wiring (#23–25) remains separate work. |
| 98–100 | pending | Negative/perf/size gates — instrumentation added (e.g. `sizeWarning` in wrapOverlayV1) but not yet CI-enforced. |

# Mobile Preview Shim — Reference Material

*Articles, docs, repos, and tools the team will need to complete the shim implementation plan.*

*Companion to: `plans/mobile-preview-shim-implementation.md`*

---

## How to onboard a new engineer

1. **Read** `plans/article-native-preview-from-browser.md` (~30 min) — architectural context for how the current runtime was reverse-engineered.
2. **Read** `plans/why-browser-only-mobile-preview.md` — plain-English explainer of why the shim exists at all.
3. **Read** `plans/mobile-preview-gap-analysis.md` — what's built vs. what's missing.
4. **Read** `plans/mobile-preview-shim-implementation.md` — the workstream plan.
5. **Clone + skim** `facebook/react-native` — specifically `packages/react-native/Libraries/Components/` and `Libraries/StyleSheet/`. Don't try to read it all; build a mental map.
6. **Clone + skim** `expo/expo` — `packages/expo-camera`, `packages/expo-file-system`, `packages/expo-modules-core`. These three teach the pattern every Expo package follows.
7. **Read the local code tour** in order:
   - `packages/mobile-preview/runtime/fabric-host-config.js`
   - `packages/mobile-preview/runtime/shell.js`
   - `packages/mobile-preview/runtime/runtime.js`
   - `apps/web/client/src/services/mobile-preview/index.ts`
8. **Run the stack end-to-end locally** — see the 20ms edit loop actually working before extending it.
9. **Pick Workstream A** — it's the foundation; every other workstream depends on it.

---

## Foundational references (everyone on the team)

### The Onlook article (local)

- `plans/article-native-preview-from-browser.md` — definitive writeup of the current runtime, bridgeless bootstrap discovery, Fabric API surface, and the eval + WebSocket hot loop. Start here.

### React Native architecture

- React Native architecture overview: <https://reactnative.dev/architecture/overview>
- Fabric renderer page: <https://reactnative.dev/architecture/fabric-renderer>
- React Native source (`packages/react-native/Libraries/`): <https://github.com/facebook/react-native/tree/main/packages/react-native/Libraries> — canonical JS-side implementation of every core component

### React reconciler internals

- `react-reconciler` package: <https://github.com/facebook/react/tree/main/packages/react-reconciler> — the host config API surface we implement in `fabric-host-config.js`
- Awesome React Renderers (curated list of example custom renderers): <https://github.com/chentsulin/awesome-react-renderer> — `react-nil`, `react-ink`, `react-three-fiber` are especially instructive

### Expo Go internals

- expo/expo monorepo: <https://github.com/expo/expo> — every Expo SDK package's JS source is under `packages/expo-*`. Gold mine for Workstream E.

---

## Workstream A — Runtime plumbing

- Sucrase: <https://github.com/alangpierce/sucrase> — the transpiler we use client-side. Review the `imports` transform output format.
- esbuild docs: <https://esbuild.github.io/> — for bundling our `shims.bundle.js` at build time
- Bun bundler: <https://bun.sh/docs/bundler> — alternative if you want to stay Bun-native (repo is Bun-first)
- Source maps v3 spec: <https://sourcemaps.info/spec.html> — needed for G5 (mapping eval errors back to user source)

### Relevant source files

- `apps/web/client/src/services/mobile-preview/index.ts` — where `wrapEvalBundle` currently stringifies shims. A1's job is to extract from here.
- `packages/mobile-preview/server/build-runtime.ts` — the build script that produces `runtime/bundle.js`. A2 extends this to build a second `shims.bundle.js`.

---

## Workstream B — Event bridge

- RN Gesture Responder System docs: <https://reactnative.dev/docs/gesture-responder-system> — mental model for event propagation
- RN Pressability source: <https://github.com/facebook/react-native/tree/main/packages/react-native/Libraries/Pressability> — how real RN implements `onPress` and bubbling
- React SyntheticEvent reference: <https://react.dev/reference/react-dom/components/common> — shape our fake events need to mimic
- Fabric event handling C++: <https://github.com/facebook/react-native/tree/main/packages/react-native/ReactCommon/react/renderer/components> — `InstanceHandle` and how events surface from native to JS
- react-native-gesture-handler architecture docs: <https://docs.swmansion.com/react-native-gesture-handler/docs/> — for wiring complex gestures

### Relevant source files

- `packages/mobile-preview/runtime/fabric-host-config.js` — where `nativeFabricUIManager.registerEventHandler` needs to be wired
- `packages/mobile-preview/runtime/shell.js` — has the existing dispatcher pattern we'll extend

---

## Workstream C — Core RN native-type mappings

- RN component source directory: <https://github.com/facebook/react-native/tree/main/packages/react-native/Libraries/Components> — one folder per component, shows exact props and behavior
- RCTScrollView source: <https://github.com/facebook/react-native/tree/main/packages/react-native/Libraries/Components/ScrollView> — reference props like `contentContainerStyle`, `onScroll`
- RCTImageView source: <https://github.com/facebook/react-native/tree/main/packages/react-native/Libraries/Image> — Image prop shape (`source`, `resizeMode`, `defaultSource`)
- RCTTextInput source: <https://github.com/facebook/react-native/tree/main/packages/react-native/Libraries/Components/TextInput> — keyboard handling, selection, placeholder
- Fabric host types in Expo Go SDK 54 (versioned RN): <https://github.com/expo/expo/tree/main/ios/versioned-react-native> — actual list of native view types available

### For Modal (C7)

- `react-native-modal` source: <https://github.com/react-native-modal/react-native-modal> — how the community handles modals without Fabric's native Modal
- Fabric multi-surface discussion: <https://github.com/reactwg/react-native-new-architecture/discussions/157> — second `rootTag` + `completeRoot` pattern

### For FlatList virtualization (C6)

- VirtualizedList source: <https://github.com/facebook/react-native/tree/main/packages/virtualized-lists> — RN's own virtualization
- Recyclerlistview (Flipkart): <https://github.com/Flipkart/recyclerlistview> — simpler alternative reference

---

## Workstream D — Style coverage

- React Native Style Reference: <https://reactnative.dev/docs/style> — every supported style prop, grouped by category
- Yoga layout engine docs: <https://www.yogalayout.dev/> — Fabric uses Yoga for flexbox; percentages, aspect ratio, layout edge cases
- RN StyleSheet source: <https://github.com/facebook/react-native/blob/main/packages/react-native/Libraries/StyleSheet/StyleSheet.js> — `create`, `flatten`, `compose` canonical behavior
- RN `processColor` source: <https://github.com/facebook/react-native/blob/main/packages/react-native/Libraries/StyleSheet/processColor.js> — reference CSS-color → ARGB converter (we should roughly match)
- CSS Transforms spec: <https://drafts.csswg.org/css-transforms/> — for building the transform matrix (D2)

---

## Workstream E — Expo SDK packages

### Master reference

- expo/expo packages directory: <https://github.com/expo/expo/tree/main/packages> — every Expo SDK package's source. For each package we want to shim:
  - Copy the JS-side implementation
  - Note the native module name it calls (`NativeModules.ExponentXxx` or `TurboModuleRegistry.getEnforcing('ExponentXxx')`)
  - Verify the native module ships in Expo Go SDK 54

### Packages worth reading deeply

- `packages/expo-modules-core` — foundation every other Expo package builds on. Understand this and the rest is mechanical.
- `packages/expo-camera` — representative of "complex permission + hardware access"
- `packages/expo-file-system` — representative of "async I/O with a native module"
- `packages/expo-notifications` — representative of "works but with caveats in Expo Go"

### Expo architecture docs

- Expo Modules API: <https://docs.expo.dev/modules/overview/> — how native modules are defined; tells you what JS surface to expect
- Expo Go limitations: <https://docs.expo.dev/workflow/expo-go/> — official list of what does/doesn't work in Expo Go (critical for Tier 6)
- Expo blog (SDK release notes): <https://blog.expo.dev/> — what versions of each package each SDK bundles

### For version lockstep (A7, H3)

- Expo template `package.json`: <https://github.com/expo/expo/blob/main/packages/create-expo/templates/expo-template-blank/package.json> — canonical version pins

---

## Workstream F — Third-party UI libraries

### @expo/vector-icons (F3)

- @expo/vector-icons source: <https://github.com/expo/vector-icons>
- react-native-vector-icons (underlying): <https://github.com/oblador/react-native-vector-icons> — each icon family has a glyph map JSON we can copy
- Ionicons: <https://github.com/ionic-team/ionicons> — canonical icon → character mapping

### react-native-screens (F1)

- react-native-screens source: <https://github.com/software-mansion/react-native-screens> — mostly a pass-through wrapper

### react-native-gesture-handler (F2)

- react-native-gesture-handler source: <https://github.com/software-mansion/react-native-gesture-handler>
- Software Mansion engineering blog: <https://blog.swmansion.com/> — deep dives on gesture recognition

### react-native-svg (F4)

- react-native-svg source: <https://github.com/software-mansion/react-native-svg>

### react-native-reanimated (F5)

- Reanimated docs: <https://docs.swmansion.com/react-native-reanimated/> — understand why a real implementation is hard (worklets run on a separate JS runtime)
- Reanimated source: <https://github.com/software-mansion/react-native-reanimated> — only needed for a real implementation post-M3

### React Navigation (F6)

- react-navigation/react-navigation: <https://github.com/react-navigation/react-navigation> — each navigator (`stack`, `bottom-tabs`) is a separate package under `packages/`
- React Navigation getting started: <https://reactnavigation.org/docs/getting-started> — public API surface we need to stub

---

## Workstream G — Hardening

- Source maps v3 spec: <https://sourcemaps.info/spec.html> — for G5
- Sucrase source map support: <https://github.com/alangpierce/sucrase#source-map-support> — we already use Sucrase
- WebSocket RFC 6455: <https://datatracker.ietf.org/doc/html/rfc6455> — if debugging ping/keepalive issues
- Bun WebSocket docs: <https://bun.sh/docs/api/websockets> — specifically `idleTimeout`, `sendPings`

---

## Workstream H — Android parity

- React Native Android architecture: <https://reactnative.dev/architecture/fabric-renderer>
- Expo Go Android source: <https://github.com/expo/expo/tree/main/android> — for verifying what's in the Android binary
- adb logcat basics: <https://developer.android.com/tools/logcat> — the equivalent of `log stream` on iOS
- Hermes source: <https://github.com/facebook/hermes> — if hitting parser oddities

---

## Workstream I — Cloudflare deployment

- Cloudflare Workers docs: <https://developers.cloudflare.com/workers/>
- Durable Objects docs: <https://developers.cloudflare.com/durable-objects/>
- Workers WebSocket (hibernation API): <https://developers.cloudflare.com/workers/runtime-apis/websockets/>
- R2 docs: <https://developers.cloudflare.com/r2/>

### Relevant source files

- `apps/cf-expo-relay/` in this repo — has a BuildSession Durable Object that's a close structural analog to the WebSocket relay we need. The `wrangler.jsonc` config and DO bootstrap are ready-made templates.

---

## Tooling

- **Transpile**: Sucrase (already used) — <https://github.com/alangpierce/sucrase>; or SWC via `@swc/wasm-web` — <https://swc.rs/>
- **Bundle**: esbuild — <https://esbuild.github.io/>; Bun.build — <https://bun.sh/docs/bundler>; Rollup — <https://rollupjs.org/>
- **Test**: `bun:test` (already used) — <https://bun.sh/docs/cli/test>; Playwright — <https://playwright.dev/>
- **Device logging (iOS)**: `log stream --predicate 'eventMessage contains "SPIKE_B"' --style compact` — see shell.js for the `_log` prefix
- **Device logging (Android)**: `adb logcat` — <https://developer.android.com/tools/logcat>
- **QR testing**: Expo Go on a real device — <https://expo.dev/go>

---

## Community reference projects

Similar problems to ours, worth studying for inspiration:

- **Snack.expo.dev**: <https://github.com/expo/snack> — Expo's own browser-based RN playground. Different architecture (uses Metro on a remote server) but package-shimming patterns are instructive.
- **Sandpack (CodeSandbox)**: <https://github.com/codesandbox/sandpack> — in-browser bundler. Reference for in-browser module resolution.
- **Rspack / Mako**: <https://github.com/web-infra-dev/rspack> — Rust-based bundlers; look at their incremental strategies if the shim bundle gets big.
- **Remotion**: <https://github.com/remotion-dev/remotion> — React-driven video generation. Their custom reconciler pattern is similar to ours.

---

## Internal repo references (cite in PR descriptions)

| Path | Purpose |
|---|---|
| `packages/mobile-preview/runtime/` | The phone-side runtime bundle + source |
| `packages/mobile-preview/server/index.ts` | Local HTTP manifest + WebSocket relay |
| `packages/mobile-preview/server/build-runtime.ts` | Runtime bundle build script |
| `apps/web/client/src/services/mobile-preview/index.ts` | The shim service (will grow with this plan) |
| `apps/web/client/src/services/mobile-preview/__tests__/index.test.ts` | Unit tests for the service |
| `apps/web/client/src/hooks/use-mobile-preview-status.tsx` | Editor-side push hook |
| `apps/web/client/src/app/project/[id]/_components/bottom-bar/expo-qr-button.tsx` | Bottom-bar QR button |
| `apps/web/client/src/app/project/[id]/_components/top-bar/preview-on-device-button.tsx` | Top-bar QR button |
| `packages/browser-metro/` | Canvas iframe's bundler (reference for Sucrase + BroadcastChannel patterns) |
| `apps/cf-expo-relay/` | Legacy pipeline, but the DO + wrangler config is a template for Workstream I |

---

## Related Onlook plan documents

- `plans/article-native-preview-from-browser.md` — original technical writeup
- `plans/why-browser-only-mobile-preview.md` — plain-English explainer
- `plans/mobile-preview-gap-analysis.md` — built vs. missing
- `plans/mobile-preview-shim-implementation.md` — the workstream plan with timeframes
- `plans/mobile-preview-shim-task-queue.md` — Codex-oriented parallel execution queue through Workstream G

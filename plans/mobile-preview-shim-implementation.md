# Mobile Preview Shim Implementation Plan

*Full plan for completing the browser-only mobile preview shim layer so typical Expo apps render and behave correctly on a real device.*

*Date: 2026-04-14*
*Owner: TBD*
*Related: `plans/mobile-preview-gap-analysis.md`, `plans/article-native-preview-from-browser.md`*

---

## Context

The browser-only mobile preview is live. The editor pushes transpiled user code to a phone running our 241KB runtime; the phone evaluates the code via eval and renders through a React 19 reconciler on top of Fabric. Round-trip on edit is ~20ms.

The current shim layer lives in `apps/web/client/src/services/mobile-preview/index.ts` (`wrapEvalBundle`). It implements a minimal CJS-style runtime that exposes a small set of `react-native` primitives, a handful of Expo packages, and nothing else. Projects that stick to `View / Text / StyleSheet` render fine. Anything richer either crashes (no event handlers, unknown components) or silently blanks the screen (styles that Fabric can't parse).

This document is the plan to close that gap so the typical Expo app — `npx create-expo-app --template tabs` plus common third-party UI libraries — works on a real device.

---

## Goals

**In scope:**

- Full coverage of `react-native` core components and APIs that the Expo Go SDK 54 runtime supports natively.
- All Expo SDK 54 packages whose native side ships in the Expo Go binary (camera, location, file system, secure store, notifications, etc.).
- Common third-party UI libraries (`@expo/vector-icons`, `react-native-gesture-handler`, `react-native-screens`, `react-native-svg`, a stub for `react-native-reanimated`).
- Interactivity: `onPress`, `onScroll`, `onChangeText`, gestures.
- A maintainable shim architecture so adding a package is ~1 hour, not a codebase rewrite.

**Out of scope (acknowledged limitations):**

- Custom native modules not in Expo Go's binary (e.g., `react-native-mmkv`, third-party SDKs with their own native code). Requires a custom dev client.
- Push notifications with the user's own Apple/Google credentials (Expo Go uses Expo's push service).
- Background tasks requiring custom `Info.plist` entries.
- App-specific URL schemes (`myapp://`).
- App Store in-app purchases against the user's own bundle ID.
- Entitlement-gated APIs: HomeKit, HealthKit, CallKit.

These are limitations of Expo Go itself — no shim implementation can address them.

---

## Current state (Tier 0 — done)

| Primitive | Status | Location |
|---|---|---|
| `View` | ✓ Real Fabric host | `packages/mobile-preview/runtime/runtime.js:72` |
| `Text` / `TextC` | ✓ Wraps strings in `RCTRawText` | `runtime.js:73,77-87` |
| `RawText` | ✓ Real Fabric host | `runtime.js:74` |
| `StyleSheet.create` | ✓ CSS-color → ARGB conversion | `services/mobile-preview/index.ts` |
| `Platform.OS`, `Platform.select` | ✓ | Service shim |
| `Dimensions.get` | ✓ (hardcoded iPhone 14 Pro) | Service shim |
| `Alert.alert` | ✓ (no-op) | Service shim |
| `AppRegistry.registerComponent('main', ...)` | ✓ Triggers `renderApp` | Service shim |
| `ScrollView`, `SafeAreaView`, `TouchableOpacity`, `TouchableHighlight`, `TouchableWithoutFeedback`, `Pressable`, `TextInput`, `Image` | ✓ Passthrough to `View`, no behavior | Service shim (`__PASSTHROUGH_VIEW`) |
| `StatusBar` | ✓ `() => null` | Service shim |
| `expo-status-bar` | ✓ `StatusBar → null` | Service shim |
| `expo-router` (Link, Stack, Tabs, Slot, useRouter, useLocalSearchParams) | ✓ Minimal stubs | Service shim |
| `react-native-safe-area-context` (SafeAreaProvider, useSafeAreaInsets) | ✓ | Service shim |
| `onlook-preload-script.js` | ✓ No-op | Service shim |

---

## Architecture decisions

### 1. Where shims live

**Today:** All shim code is concatenated as strings inside `wrapEvalBundle()`. That's fine for ~200 lines; it doesn't scale to 20+ packages.

**Target:** Move shims into `packages/mobile-preview/runtime/shims/` as proper JavaScript modules, pre-bundled at build time. The runtime exposes them via a module registry attached to `globalThis.__onlookShims`. The service's `__require` checks the registry first, before falling back to user modules.

Benefits:
- Shims become unit-testable
- Version control is clean (each package is a file)
- Runtime bundle grows, but the per-edit push stays small (it only contains user code)

### 2. NativeModules bridge (unlocks the "impossible" tier)

Expo Go's binary already compiles in the native side of ~25 Expo packages (camera, location, etc.). The JS-side wrapper accesses them via `NativeModules.ExponentXxx` or `TurboModuleRegistry.getEnforcing('ExponentXxx')`. Our `__reactNative` shim currently doesn't expose these.

Add:

```js
NativeModules: new Proxy({}, {
  get(_, name) {
    return globalThis.nativeModuleProxy?.[name]
      || globalThis.__turboModuleProxy?.(name);
  }
}),
TurboModuleRegistry: {
  get(name) { return globalThis.__turboModuleProxy?.(name) ?? null; },
  getEnforcing(name) {
    const m = globalThis.__turboModuleProxy?.(name);
    if (!m) throw new Error(`TurboModule ${name} not found`);
    return m;
  },
},
```

This is ~2 hours of work and unlocks every native module Expo Go ships with.

### 3. Event bridge (interactivity)

Currently `onPress` / `onChangeText` / `onScroll` are props that get ignored. To make them fire:

1. In the runtime (`shell.js` or `fabric-host-config.js`), register a global Fabric event handler via `nativeFabricUIManager.registerEventHandler((type, targetTag, payload) => ...)`.
2. Maintain a `handlers[tag][eventName]` map. When the reconciler creates a node with event props, store the handler.
3. When Fabric dispatches an event, look up the handler by tag and call it with a synthetic event object matching React Native's shape.
4. Handle event bubbling for events that need it.

For gestures (pan, pinch, long-press), the same mechanism applies via `react-native-gesture-handler`'s native side.

### 4. SDK version lockstep

Our runtime's bundled JS wrappers must match the Expo Go SDK version's native side. SDK 54 native = SDK 54 JS wrappers. Mismatch → ABI errors at runtime.

**Approach:** Pin the runtime to SDK 54. Validate the user's `package.json#dependencies.expo` at build time; refuse to push if the user's expo version isn't compatible with the runtime's.

Long-term: ship multiple runtime versions (one per SDK) and select based on the project's `expo` dependency.

### 5. Asset resolution

`require('./logo.png')` is a common pattern. Metro inlines assets. Our current bundler doesn't — it treats `.png` as an unknown specifier and crashes.

**Approach:**

- At build time, detect asset imports (`.png`, `.jpg`, `.webp`, `.svg`, font files)
- Encode as `data:` URIs inline in the push bundle (size ceiling: ~1MB total)
- For larger assets, upload to R2 (production) or serve from the mobile-preview server (local dev), rewrite imports to the resulting URL
- `Image source={{ uri }}` then points at the resolved URL

### 6. Error pipeline

Currently eval errors land in `iOS Console.app` via `_log`. Users don't see them. The runtime already sends `{type:'evalError', error: msg}` back over the WebSocket (`shell.js:241`). The editor receives it but doesn't surface it.

**Approach:** The editor's push service listens for inbound WebSocket messages, parses `evalError`, and surfaces them in a dedicated panel (or reuses the existing code editor "Problems" tab). Users see the runtime error next to their source.

---

## Workstreams

Each workstream is independently deliverable. They can run in parallel where noted.

---

### Workstream A — Runtime plumbing (foundation)

**Goal:** Prepare the runtime architecture so subsequent workstreams can drop in shims cleanly.

| Task | Detail | Effort |
|---|---|---|
| A1 | Extract shim strings from `wrapEvalBundle` into `packages/mobile-preview/runtime/shims/` modules | 1 day |
| A2 | Build-time bundling of shims into `globalThis.__onlookShims` registry | 0.5 day |
| A3 | Update `__require` in `services/mobile-preview/index.ts` to check registry first | 0.5 day |
| A4 | Add `NativeModules` / `TurboModuleRegistry` passthrough to `react-native` shim | 0.5 day |
| A5 | Error pipeline: editor subscribes to WS `evalError` messages and surfaces them | 1 day |
| A6 | Asset resolution: `.png` / `.jpg` → data URI in bundle | 1 day |
| A7 | SDK version validation: reject pushes when user's `expo` version mismatches runtime | 0.5 day |
| A8 | Runtime rebuild script + versioning (tag bundle with SDK version) | 0.5 day |

**Effort: ~5 days.**

**Blocks:** All subsequent workstreams. Do this first.

---

### Workstream B — Event bridge (interactivity)

**Goal:** `onPress`, `onChangeText`, `onScroll`, gestures actually fire.

| Task | Detail | Effort |
|---|---|---|
| B1 | In `fabric-host-config.js`, wire `nativeFabricUIManager.registerEventHandler` | 1 day |
| B2 | Build `handlers[tag][eventName]` map in reconciler's `createInstance` + `commitUpdate` | 1 day |
| B3 | Synthetic event object matching RN's shape (`event.nativeEvent.text`, `.pageX`, etc.) | 1 day |
| B4 | Event bubbling for `onPress` on Touchables (walk parent chain) | 0.5 day |
| B5 | `TextInput` two-way binding: onChangeText fires, controlled value via `text` prop | 1 day |
| B6 | `ScrollView` onScroll with contentOffset | 0.5 day |
| B7 | Device test: all four Touchables + TextInput + ScrollView on real iPhone | 1 day |

**Effort: ~6 days.**

**Depends on:** A1, A2.

**Unlocks:** Functional forms, menus, navigation triggers, any tap-driven UI.

---

### Workstream C — Core RN native-type mappings

**Goal:** Replace passthrough stubs with real Fabric mappings so `ScrollView` scrolls, `Image` shows pictures, `TextInput` accepts input.

| Task | Detail | Effort |
|---|---|---|
| C1 | `ScrollView` → `RCTScrollView` host type with `contentContainerStyle`, `showsVerticalScrollIndicator`, etc. | 1 day |
| C2 | `Image` → `RCTImageView` with `source={uri}`, `resizeMode`, loading states. Requires A6 asset resolution. | 1 day |
| C3 | `TextInput` → `RCTSinglelineTextInputView` / `RCTMultilineTextInputView`. Requires B5. | 1 day |
| C4 | `Switch` → `RCTSwitch` (on/off, color, onValueChange) | 0.5 day |
| C5 | `ActivityIndicator` → `RCTActivityIndicatorView` (animating, color, size) | 0.5 day |
| C6 | `FlatList` / `SectionList` — pure JS over ScrollView, no virtualization in v1 | 1.5 days |
| C7 | `Modal` — separate Fabric surface via second rootTag + `completeRoot` | 2 days |
| C8 | Device test: forms, scrolling lists, images, modals | 1 day |

**Effort: ~9 days.**

**Depends on:** A6 for Image, B5 for TextInput. Can run partially in parallel with B.

---

### Workstream D — Style prop coverage

**Goal:** Styles that real RN apps use render correctly in Fabric.

| Task | Detail | Effort |
|---|---|---|
| D1 | Percentage dimensions (`width: '50%'`) — resolve against parent at style-flatten time | 1 day |
| D2 | `transform: [{translateX}, {rotate}, {scale}]` — build matrix, convert degrees→radians | 1 day |
| D3 | Shadow props (`shadowColor`, `shadowOffset`, `shadowOpacity`, `shadowRadius`) — iOS Fabric passthrough | 0.5 day |
| D4 | `elevation` — Android-only, noop on iOS | 0.1 day |
| D5 | Typography extras: `letterSpacing`, `textShadow*`, `textDecorationLine`, `fontFamily` (no actual font loading) | 1 day |
| D6 | Border styles (`borderStyle: 'solid'/'dashed'/'dotted'`), per-side borders | 0.5 day |
| D7 | `opacity`, `overflow`, `zIndex` | 0.5 day |
| D8 | Device test: complex layouts with rotate, shadow, percentages | 0.5 day |

**Effort: ~5 days.**

**Depends on:** A1. Can run in parallel with B and C.

---

### Workstream E — Expo SDK packages

**Goal:** All Expo SDK 54 packages whose native side ships in Expo Go work end-to-end.

For each package: audit the JS wrapper's source → copy to `shims/<pkg>.js` → transform imports → add to shim registry → device test.

**Tier E1 — Trivial stubs (already logically done, just move to registry):**

| Package | Effort |
|---|---|
| `expo-constants` | 0.5 day (return `app.json` config) |
| `expo-linking` | 0.5 day (`createURL`, `openURL`, `canOpenURL`) |
| `expo-splash-screen` | 0.2 day (no-ops + resolved promises) |
| `expo-system-ui` | 0.2 day (no-ops) |
| `expo-web-browser` | 0.5 day (native-bridged `openBrowserAsync`) |
| `expo-font` | 0.5 day (`useFonts` returns `[true, null]`) |
| `expo-haptics` | 0.5 day (native-bridged impact/notification) |
| `expo-clipboard` | 0.5 day (native-bridged) |
| `expo-battery` | 0.3 day (native-bridged info) |
| `expo-device` | 0.3 day (native-bridged info) |
| `expo-network` | 0.3 day (native-bridged info) |

**Tier E1 subtotal: ~5 days.**

**Tier E2 — Native-backed packages (real functionality via NativeModules bridge):**

| Package | Effort | Notes |
|---|---|---|
| `expo-camera` | 1.5 days | Permission flow, CameraView preview, photo/video capture |
| `expo-location` | 1 day | `getCurrentPositionAsync`, `watchPositionAsync`, geofencing |
| `expo-file-system` | 1 day | readAsync, writeAsync, deleteAsync, downloadAsync |
| `expo-secure-store` | 0.5 day | `setItemAsync`, `getItemAsync` |
| `expo-notifications` | 1.5 days | Local notifications work; Expo push token only (not own creds) |
| `expo-av` | 2 days | Audio playback/record, Video component |
| `expo-local-authentication` | 0.5 day | Face ID / Touch ID |
| `expo-image-picker` | 1 day | `launchImageLibraryAsync`, `launchCameraAsync` |
| `expo-contacts` | 0.5 day | `getContactsAsync` with permission flow |
| `expo-calendar` | 0.5 day | event CRUD |
| `expo-sensors` | 1 day | Accelerometer, Gyroscope, Magnetometer subscription APIs |
| `expo-image` | 1 day | Enhanced Image with caching/blurhash (cache can be a thin stub) |

**Tier E2 subtotal: ~12 days.**

**Workstream E total: ~17 days.**

**Depends on:** A4 (NativeModules bridge) for E2.

---

### Workstream F — Third-party UI libraries

**Goal:** Ship shims for the libraries the tabs template and most polished apps use.

| Package | Effort | Strategy |
|---|---|---|
| `react-native-screens` | 0.5 day | Pass-through views; `enableScreens` is a no-op |
| `react-native-gesture-handler` | 2 days | GestureHandlerRootView wraps in View; gesture recognizers use B event bridge |
| `@expo/vector-icons` | 3 days | Each icon family (Ionicons, MaterialIcons, FontAwesome, Feather, AntDesign, Entypo, EvilIcons, Foundation, MaterialCommunityIcons, Octicons, SimpleLineIcons, Zocial) = a component that renders a glyph character in `Text`. Requires font-name loading via `expo-font` or fallback to the emoji approximation. ~25 families. |
| `react-native-svg` | 3 days | Map `<Svg>`, `<Path>`, `<Circle>`, `<Rect>`, `<Line>`, `<G>` to Fabric primitives. Likely needs an `RCTSVG` host or a canvas-based fallback. Complex. |
| `react-native-reanimated` | 2 days | Stub: `useSharedValue → {value: initial}`, `useAnimatedStyle → passthrough`, skip animations. Users see static UI; no animations but no crashes. |
| `@react-navigation/native`, `@react-navigation/bottom-tabs`, `@react-navigation/stack` | 3 days | May be covered by expo-router stub for some cases. For direct use, implement a minimal NavigationContainer + Stack/Tab navigators that manage state and render one screen at a time. |
| `react-native-paper` | not in v1 | Material Design library, huge. Defer. |
| `nativewind` / `tailwind-rn` | 0.5 day | CSS-to-RN compiler runs in user's bundle; we just need to not break it. Verify import works. |

**Effort: ~14 days.**

**Depends on:** B for gesture-handler. A1 for everything.

---

### Workstream G — Hardening & polish

**Goal:** Go from "works for the happy path" to "works for real projects."

| Task | Detail | Effort |
|---|---|---|
| G1 | WebSocket reconnection in `shell.js` with exponential backoff | 1 day |
| G2 | Runtime-side keepalive + dead-connection detection | 0.5 day |
| G3 | Editor UI: connection status indicator (poll `/status`, show clients count) | 0.5 day |
| G4 | Push error surfacing (via A5) in a panel, with source mapping | 2 days |
| G5 | Source maps: map eval errors to user's original file:line | 2 days |
| G6 | Bundle size budget: warn if push exceeds 500KB, hard-fail at 2MB | 0.5 day |
| G7 | Unsupported-import preflight: reject builds with imports not in the registry, show clear message | 0.5 day |
| G8 | Regression test suite: golden projects (blank, tabs, navigation) auto-push + snapshot the render | 2 days |

**Effort: ~9 days.**

**Depends on:** A1, A5.

---

### Workstream H — Android parity validation

**Goal:** The same runtime bundle works on Android Expo Go.

| Task | Detail | Effort |
|---|---|---|
| H1 | Side-by-side scan on iOS + Android, compare render output | 0.5 day |
| H2 | Fix any Android-specific divergence in Fabric primitive names | 1 day |
| H3 | Android `NativeModules` naming differs from iOS (`RCTXXX` vs `ExponentXXX`) — audit each E2 package | 1 day |
| H4 | `elevation` on Android requires explicit prop | (covered in D4) |
| H5 | Regression test on Android (Pixel + emulator) | 1 day |

**Effort: ~3.5 days.**

**Depends on:** D and E done.

---

### Workstream I — Cloudflare production deployment

**Goal:** The mobile-preview server runs on Cloudflare Workers for production.

| Task | Detail | Effort |
|---|---|---|
| I1 | Upload `runtime/bundle.js` + shims bundle to R2; CI step for versioning | 1 day |
| I2 | Port `server/index.ts` manifest serving to a CF Worker | 2 days |
| I3 | Durable Object for WebSocket relay (session-keyed) | 3 days |
| I4 | Editor config: point `NEXT_PUBLIC_MOBILE_PREVIEW_URL` at CF endpoint | 0.5 day |
| I5 | Production smoke test: full round trip from editor to real phone via CF | 1 day |
| I6 | Decommission `apps/cf-esm-builder/` and local shims | 1 day |

**Effort: ~8.5 days.**

**Depends on:** A-G stable. Can start planning I1-I3 in parallel with later workstreams.

---

## Effort summary

| Workstream | Duration |
|---|---|
| A — Runtime plumbing | 5 days |
| B — Event bridge | 6 days |
| C — Core RN mappings | 9 days |
| D — Style coverage | 5 days |
| E — Expo SDK packages | 17 days |
| F — Third-party UI | 14 days |
| G — Hardening | 9 days |
| H — Android validation | 3.5 days |
| I — CF deployment | 8.5 days |
| **Total (serial)** | **~77 days (~15–16 weeks)** |
| **Total (parallelized, 2 engineers)** | **~8–10 weeks** |
| **Total (parallelized, 3 engineers)** | **~6–7 weeks** |

---

## Rollout milestones

### Milestone 1 — "Forms work" (~2 weeks)
Workstreams A + B + D + C1 (ScrollView) + C3 (TextInput) + E1 (trivial Expo stubs).
Deliverable: typical form screens with text input, scroll, and basic styles work on a real device.

### Milestone 2 — "Tabs template works" (~4 weeks)
Milestone 1 + C2 (Image) + C6 (FlatList) + F1-F3 (screens, gesture-handler, vector-icons) + E2 partial (camera, location, file-system).
Deliverable: the full `npx create-expo-app --template tabs` project scans, renders, and responds to taps.

### Milestone 3 — "Polished apps work" (~7 weeks)
Milestone 2 + rest of E2 + F4 (SVG) + F5 (reanimated stub) + F6 (navigation if not covered by router) + G.
Deliverable: typical production Expo apps (without custom native modules) work end-to-end.

### Milestone 4 — "Production deployment" (~10 weeks)
Milestone 3 + H + I.
Deliverable: runs on Cloudflare Workers, validated on Android + iOS.

---

## Risks

1. **SDK version drift.** Each Expo SDK release changes native module ABIs. Keeping our shims aligned is ongoing maintenance. Mitigation: tag the runtime with an SDK version; CI task that runs against each active SDK.

2. **Fabric behavioral differences between iOS and Android.** The same Fabric primitive may render slightly differently. Mitigation: H (Android validation) budgeted; golden image diffs in G8.

3. **Asset size blowup.** Projects with lots of images/fonts will push large bundles. Mitigation: G6 budget + R2-hosted asset pipeline for large files.

4. **`react-native-reanimated` users see dead animations.** Stub returns static values. Mitigation: document the limitation; plan a real implementation (Tier 6 of the gap analysis) post-M3.

5. **Hermes eval() performance with large bundles.** The article's 20ms round trip assumes small component trees. A full tabs app with all packages inlined could be 1-2MB of eval code, slower to parse. Mitigation: measure; if it's a problem, split shims to load-once (in the runtime, cached) vs. per-edit (user code only).

6. **Event ordering and bubbling edge cases.** Real RN's touch responder system is complex (capture, grant, etc.). A simplified synthetic event dispatcher may miss edge cases. Mitigation: start with the common cases (`onPress`, `onChangeText`, `onScroll`), add more as users report specific bugs.

7. **Custom native modules.** Users who import `react-native-mmkv` or third-party SDKs get clear errors but can't work. Mitigation: G7 preflight check lists the specific unsupported import; document custom dev client path as a future option.

---

## Success criteria

- `create-expo-app` blank and tabs templates render and behave correctly on a real iPhone and a real Android device within 10ms of an editor save.
- 100% of the Expo SDK 54 packages that Expo Go supports natively are importable and functional.
- 90%+ of the top 20 npm packages from the React Native ecosystem (by weekly downloads) work or have a documented stub.
- Runtime bundle ≤ 500KB (target) / ≤ 2MB (hard ceiling).
- Average push ≤ 100KB for typical per-screen edits.
- Editor UI surfaces runtime errors inline, with source-mapped file/line links.

---

## Open decisions

1. **Shim registry format.** Proposed: single `runtime/shims.bundle.js` built by esbuild. Alternative: individual shim chunks, lazy-loaded via dynamic import. Decision: start with single bundle; move to lazy only if size becomes a problem.

2. **Asset handling.** Proposed: inline as data URIs up to 512KB per asset; larger assets → R2 upload with signed URLs. Alternative: always inline (simpler, larger bundles) or always R2 (latency). Decision: data URI ceiling, tuneable.

3. **Multiple SDK support.** Proposed: single SDK 54 runtime initially. Alternative: ship runtimes for SDK 52, 53, 54 in parallel. Decision: defer; single SDK for M1-M3.

4. **`react-native-reanimated` real implementation.** Proposed: stub only in v1. Real implementation requires shared values via worklets on a second JS runtime — weeks of work. Decision: stub in v1, revisit post-M3.

5. **Error boundary / recovery.** Proposed: eval errors reset the render to a "runtime ready" placeholder so the next push starts clean. Alternative: freeze last-rendered frame + show error overlay. Decision: placeholder reset in M1, error overlay in M3 (after error pipeline is built in A5).

---

## Appendix: current file inventory

**Runtime:**
- `packages/mobile-preview/runtime/bundle.js` — pre-built 256KB artifact (will grow with shims)
- `packages/mobile-preview/runtime/entry.js` — entrypoint: loads shell then runtime
- `packages/mobile-preview/runtime/shell.js` — Fabric bootstrap, WebSocket handler, eval dispatcher, default loading screen
- `packages/mobile-preview/runtime/runtime.js` — React + reconciler + createHostConfig wiring
- `packages/mobile-preview/runtime/fabric-host-config.js` — reconciler → Fabric primitive mapping
- `packages/mobile-preview/server/index.ts` — local HTTP manifest + WS relay
- `packages/mobile-preview/server/build-runtime.ts` — runtime bundle build script

**Editor side:**
- `apps/web/client/src/services/mobile-preview/index.ts` — transpile + bundle + push service (this is where `wrapEvalBundle` lives)
- `apps/web/client/src/hooks/use-mobile-preview-status.tsx` — React hook: polls `/status`, subscribes to BroadcastChannel, auto-pushes on edit
- `apps/web/client/src/app/project/[id]/_components/bottom-bar/expo-qr-button.tsx` — bottom-bar QR button (wired)
- `apps/web/client/src/app/project/[id]/_components/top-bar/preview-on-device-button.tsx` — top-bar QR button (wired)

**Env:**
- `NEXT_PUBLIC_MOBILE_PREVIEW_URL=http://localhost:8787` in `apps/web/client/.env.local`

# Onlook Mobile Client — Development Plan

A purpose-built native iOS/Android app that replaces stock Expo Go in the Onlook preview pipeline. Designed from day one to consume Onlook's existing Cloudflare Worker relay (`apps/cf-expo-relay`), `@onlook/browser-metro` IIFE bundles, and the `ExpoBrowserProvider` Supabase Storage layout — without the reverse-engineered shims that Spike B had to use to coerce Expo Go into mounting custom bundles.

## Why a custom client (and not "just keep using Expo Go")

Onlook already ships a working end-to-end native preview through stock Expo Go. The architecture works (Spike B / Phase R proved it on a real iPhone, ~3ms module-init→mount, ~20ms edit→pixels). But that path has structural ceilings the team will hit in production:

| Stock Expo Go pain point | What the custom client unlocks |
|---|---|
| Bridgeless+new-arch mount path is undocumented and was reverse-engineered (B1–B9). Each Expo SDK bump risks breaking the path. | Onlook owns the native shell, so we expose `OnlookRuntime.runApplication(bundle)` as a first-class entry point. No JSI scraping, no `nativeFabricUIManager` probing. |
| The 241KB runtime (React 19 + reconciler + Fabric host config + scheduler polyfills) has to be re-shipped inside every bundle the relay serves. | Bake the runtime into the binary. Bundles drop from ~250KB → ~5–20KB of pure user code. First-paint latency drops correspondingly. |
| Apple/Google have no direct quarrel with Expo Go, but a third-party app loading remote JS through it is novel surface area. Onlook has no control over the binary's review posture. | Onlook controls submission, entitlements, and the "this app loads code authored in your Onlook workspace" framing. Distribute via TestFlight/internal track first; production submission later. |
| Onlook's click-to-select / penpal-equivalent on native is impossible — Expo Go doesn't expose touch event capture to arbitrary bundles. | Ship a native `OnlookInspector` module that captures taps, walks the Fabric tree, and posts `componentTag → source range` back over the relay WebSocket. Mirrors the existing browser preload-script `screenshot.ts` flow. |
| Onlook can't add native modules (e.g., authenticated Supabase upload, error-stream WebSocket, screenshot capture without `idevicescreenshot`). | Bundle exactly the native modules Onlook needs and nothing else. Smaller binary, predictable surface. |
| Onlook can't brand the experience or ship in-app onboarding ("scan the QR in your editor"). | First-run flow points straight at the editor's QR modal. No "what is Expo Go?" detour. |
| Stock Expo Go ignores SDK version mismatches — bundles silently fail to mount with C++ crashes. | Onlook client validates the bundle envelope (`onlookRuntimeVersion`, `bundleFormat`) before mount and shows an actionable error. |

**Non-goal:** replacing Expo Go for the broader RN ecosystem. This client only loads bundles produced by `@onlook/browser-metro` and served by `apps/cf-expo-relay`. It does not need to be a general-purpose dev client.

---

## Architectural anchors (what already exists and must be respected)

Before any new work starts, the plan assumes these are stable and the client must be built around them:

- **`apps/cf-expo-relay/`** — Durable Object–backed relay. Routes: `/manifest/<sessionId>`, `/bundle/<sessionId>`, WebSocket upgrade for live reload. Bundles persist in KV with 1hr TTL. The custom client must speak the same manifest schema as stock Expo Go does today (so the relay code is unchanged for v1).
- **`packages/browser-metro/src/host/iife-wrapper.ts`** — produces async-IIFE bundles with a top-level `await Promise.all(__urlImports.map(import))` shim and a URL-aware `require()` shim. The client must accept this IIFE format directly. No Metro `__d()/__r()` re-wrapping.
- **`packages/browser-metro/src/host/bare-import-rewriter.ts`** — rewrites bare imports to esm.sh URLs at bundle time. The client's runtime must support fetching ESM modules at mount time (mirrors what the iframe does in the browser preview path).
- **`packages/code-provider/src/providers/expo-browser/`** — stores project files at `expo-projects/<projectId>/<branchId>/<filePath>` in Supabase Storage. Phase R already wired the editor's authed `@supabase/supabase-js` client into the provider (FOUND-R1.7 fix). The mobile client does not touch Storage directly — it only consumes whatever the relay serves.
- **241KB Onlook runtime** — `react@19.1.0` + `react-reconciler@0.32.0` + `scheduler@0.26.0` + custom Fabric host config + Hermes polyfills (`setTimeout`, `MessageChannel`, `performance.now`, `queueMicrotask`). This bundle exists today inside the bundles served by the relay. The custom client moves it from "shipped per-bundle" to "baked into the binary."
- **Spike B's mount sequence** — `nativeFabricUIManager.registerEventHandler` → `RN$registerCallableModule('HMRClient', …)` → `global.RN$AppRegistry.runApplication(...)`. The custom client replaces this scraping path with a documented `OnlookRuntime.runApplication(bundleSource, props)` JSI binding the Onlook native side controls directly.
- **Existing penpal channel** at `apps/web/preload/script/api/screenshot.ts` is the model for bidirectional communication. The mobile client's debug stream should look the same shape on the wire so the editor's Frame view can consume it without a second protocol.

Anything that breaks one of these anchors needs an explicit ADR before implementation.

---

## Phase 1 — Native shell scaffold

Goal: a buildable iOS/Android app that boots, loads a hermes JS context, and renders a hardcoded Fabric tree. No relay, no bundle loading, no UI.

- Create the workspace at `apps/mobile-client/` (matches the monorepo's existing `apps/*` layout — same place `cf-expo-relay`, `cf-esm-builder`, `cf-esm-cache` live).
- Use `expo prebuild` once to generate the iOS/Android projects, then commit them and treat them as first-class native code (no more `expo prebuild`). Rationale: we need to write Swift/Kotlin native modules and we don't want managed-workflow indirection sitting between Onlook and the platform.
- Wire React Native 0.81+ with bridgeless + new arch (Fabric) enabled. Mirror Expo Go SDK 54's Hermes runtime version exactly so existing bundles validated against that runtime continue to mount.
- Strip every Expo module that Onlook bundles don't need. Initial allowlist: `expo-camera` (QR), `expo-secure-store` (auth token), `expo-haptics` (debug-menu feedback). Everything else stays out. Document the allowlist in `apps/mobile-client/SUPPORTED_MODULES.md`.
- Smoke-test target: `bun run mobile:build:ios` produces a signed development build that boots to a black screen and prints `[onlook-runtime] hermes ready` in the device log.

## Phase 2 — `OnlookRuntime` JSI binding

Goal: replace Spike B's scraping path with a first-class JSI entry point Onlook controls.

- Implement `OnlookRuntime` as a JSI host object exposed on `global.OnlookRuntime`. Methods:
  - `runApplication(bundleSource: string, props: object): void` — evaluates the bundle in a fresh Hermes context, registers the Fabric event handler, and calls the bundle's exported `onlookMount(rootTag, props)` function.
  - `reloadBundle(bundleSource: string): void` — atomic swap. Tears down the existing Fabric tree via `completeRoot(rootTag, emptyChildSet)`, evaluates the new bundle, calls `onlookMount` again. State is intentionally not preserved at the runtime level (HMR is the bundler's job, not the shell's).
  - `dispatchEvent(name: string, payload: object): void` — for the inspector pipeline (Phase 4).
- The 241KB Onlook runtime (React 19 + reconciler + Fabric host config + Hermes polyfills) is bundled at app build time as a static asset and `eval()`'d into the Hermes context **once** before any user bundle loads. User bundles assume `React`, `ReactReconciler`, `__urlImports`, `__urlCache`, and the Fabric host helpers are already in scope.
- Replace Spike B's brittle handshake (`HMRClient.setup` callable-module probe, `RN$AppRegistry` JSI lookup) with a deterministic native init that runs before any JS executes:
  1. Native registers the Fabric event handler (`UIManagerBinding::registerEventHandler` directly in C++).
  2. Native installs `OnlookRuntime` on `global`.
  3. Native loads the runtime asset into Hermes.
  4. Only then does native call into the relay client (Phase 3) to fetch the user bundle.
- Hermes parser constraint from Spike B applies: no top-level ES `import`/`export` inside function scope. The `iife-wrapper.ts` already produces conformant output, but add a unit test in `packages/browser-metro/src/host/__tests__/iife-wrapper.test.ts` that explicitly asserts no `export` survives at the top level.
- Smoke-test target: `OnlookRuntime.runApplication(<hardcoded bundle that calls React.createElement('View', { style: { width: 100, height: 100, backgroundColor: 'red' } }))` paints a red square. Same proof Spike B6 produced, but achieved through a documented entry point instead of reverse engineering.

## Phase 3 — Relay client + QR onboarding

Goal: from a fresh app launch, scan a QR code, load a bundle from `cf-expo-relay`, mount it.

- QR format: `onlook://launch?session=<sessionId>&relay=<relayHostOptional>`. Default relay host is the production deployment of `cf-expo-relay`; the optional override exists for local dev (`http://localhost:8787`) and for self-hosted Onlook installs.
- The editor already has a QR modal (`apps/web/client/src/components/.../qr-modal/`, exercised by Phase Q's tests). The client's deep-link handler maps to the same scheme; no changes to the editor side except updating the QR payload to emit `onlook://` in addition to `exp://` while the client is in beta.
- Native launcher screen (Phase 1's black screen becomes a real launcher):
  - "Scan QR code" — opens `expo-camera` barcode reader
  - "Recent sessions" — `expo-secure-store`-backed list of `(sessionId, projectName, lastSeen)` tuples; tap to reconnect to the relay's WebSocket and pull the latest bundle
  - "Settings" — relay host override, clear cache, toggle dev menu
- Bundle fetch path:
  1. `GET <relay>/manifest/<sessionId>` — same multipart/mixed schema the relay already serves to stock Expo Go. Validate `expoClient.extra.onlookRuntimeVersion` matches `OnlookRuntime.version`. Mismatch → friendly upgrade prompt with deep link to TestFlight/Play Store update.
  2. `GET <launchAsset.url>` — fetch the IIFE bundle as text.
  3. Pass to `OnlookRuntime.runApplication(bundleText, manifestProps)`.
- WebSocket: open as soon as a session is loaded. Listen for `bundleUpdate` messages (relay pushes these when the editor saves). On message, fetch the new bundle via the same `/bundle/<sessionId>` endpoint and call `OnlookRuntime.reloadBundle()`. This replaces stock Expo Go's `HMRClient.setup` path entirely — Onlook controls both ends of the wire.
- Error handling: every failure mode in the bundle pipeline gets a user-visible screen with a "copy debug info" button. The debug info bundles `sessionId`, `manifest`, `relayHost`, `clientVersion`, `runtimeVersion`, last 50 console lines. Acceptable failure modes to handle explicitly: relay unreachable, manifest 404, manifest schema mismatch, bundle 404, bundle parse error, runtime version mismatch, mount-time JS exception.
- Smoke-test target: scan a QR generated by the local editor against `localhost:8787` → see the `verification/onlook-editor/reference/06-real-bundle.png` "Hello, Onlook!" content render on the device.

## Phase 4 — `OnlookInspector` (the click-to-edit native module)

Goal: ship the native equivalent of `apps/web/preload/script/api/screenshot.ts` and `inspect.ts`. This is the single biggest user-facing differentiator from stock Expo Go.

- Native module `OnlookInspector` (Swift on iOS, Kotlin on Android) registered through the new arch's TurboModule path.
- API surface (exposed on `global.OnlookInspector`):
  - `captureTap(x: number, y: number): { reactTag: number, viewName: string, frame: Rect } | null` — uses the existing Fabric `findNodeAtPoint` primitive that Spike B catalogued. Already proven to exist on `nativeFabricUIManager`.
  - `walkTree(reactTag: number): { tag, viewName, props, children }` — walks the shadow tree from a given reactTag using `cloneNodeWithNewChildren` introspection.
  - `captureScreenshot(): Promise<string>` — base64 PNG. Native side uses `UIView.snapshot(after:afterScreenUpdates:)` on iOS and `View.draw(canvas)` on Android. No `idevicescreenshot` dependency (Phase B's debug loop graduates from "Mac-attached only" to "works for any user").
  - `highlightNode(reactTag: number, color: ARGB): void` — draws a 2px overlay border on the targeted view for ~600ms. Used by the editor when the user hovers a component in the file tree.
- Tap-to-source pipeline:
  1. `OnlookInspector` listens for tap events on the Fabric root (registered through `registerEventHandler` — already required for mount, so no new native plumbing).
  2. On tap, native captures `reactTag`, builds the node descriptor, and posts it to JS via the existing `RCTDeviceEventEmitter` channel.
  3. JS-side handler in the runtime bundle reads `props.__source` (the `__source` prop is what `@babel/plugin-transform-react-jsx-source` injects — but `browser-metro` uses Sucrase, which doesn't add it). **Action item:** add a `--jsx-source` mode to `browser-metro`'s Sucrase pipeline that emits `__source: { fileName, lineNumber, columnNumber }` for every JSX call site. Gate behind `process.env.NODE_ENV !== 'production'` so production bundles aren't bloated.
  4. The runtime sends `{ type: 'onlook:select', source }` over the relay WebSocket. The CF relay routes it to the editor session. The editor opens the file at the right line in Monaco.
- This is the closing of the loop: editor → bundle → device → tap → editor cursor jump. Same UX as the existing browser iframe click-to-edit, now on a physical phone.

## Phase 5 — Built-in debug surface

The original Phase 6 of `custom-expo-client-plan.md` is still mostly relevant, but Onlook can be much more opinionated because we control both ends:

- **Console relay** — `console.log/warn/error` are intercepted in the runtime bundle (already true today; the existing 241KB runtime has the shim). The mobile client adds a native side that streams entries over the relay WebSocket as `{ type: 'onlook:console', level, args, timestamp }`. The editor surfaces them in its existing dev panel — no separate web dashboard.
- **Network inspector** — global `fetch`/`XHR` patch in the runtime bundle. Same wire format as console relay, type `onlook:network`. Editor renders.
- **Error boundary** — global error boundary in the runtime bundle catches React errors. Native side catches JS exceptions thrown from `OnlookRuntime.runApplication` (Hermes returns them through the JSI call). Both surface a friendly "your app crashed" overlay on-device with a "view in editor" button that pings the editor session.
- **In-app dev menu** — replaces stock Expo Go's shake gesture. Three-finger long-press opens an overlay with: reload bundle, clear async storage, toggle inspector overlay, copy session ID, view recent logs. Implemented as a React component inside the runtime bundle, not as native UI — that way it ships once and updates with the runtime.
- **No Sentry / no third-party crash reporter in v1.** The relay already captures everything. Adding Sentry on top means a second telemetry pipeline with no incremental value while the user base is small.

## Phase 6 — Distribution

- iOS: TestFlight only for v1. The "this app evaluates code authored in your linked Onlook workspace" framing is acceptable for TestFlight; production App Store submission is a separate effort with its own ADR (the original plan's Apple-review concern still applies).
- Android: Play Store internal testing track. Same framing.
- Update channels: ship binary updates via TestFlight/Play. The 241KB runtime is bundled into the binary, so any change to React/reconciler/Fabric host config requires a binary release. This is an acceptable tradeoff for v1 — we're not optimizing for shipping runtime updates daily.
- Versioning: every binary publishes its supported `onlookRuntimeVersion` at build time. The relay's manifest builder (`apps/cf-expo-relay/src/manifest-builder.ts`) is updated to include this field in `extra.expoClient`, and the client refuses to mount mismatched bundles.

---

## Cut lines (deferred from v1)

These are intentionally NOT in the plan, but each has a follow-up ticket waiting:

- **EAS Update support / production hosted bundles** — the existing `cf-expo-relay` is the only bundle source v1 cares about. EAS Update is a separate world.
- **HMR with state preservation** — the runtime bundle currently does full reloads. React Refresh integration is a Sprint N+1 item. State loss on each save is an acceptable v1 cost.
- **Multi-session / project switcher** — v1 mounts one session at a time. Switching sessions tears down the Fabric tree and remounts.
- **Android-side `OnlookInspector` parity** — iOS first because the existing Phase B verification rig is iPhone-only. Android lands in Phase 4.5.
- **Self-service relay deployment** — the client hardcodes the production relay URL with a settings override. A "bring your own relay" UX is later.
- **Push notifications, deep linking from external apps, slow-network simulation, Redux DevTools, location override** — all of these from the source plan are Onlook-irrelevant or premature. Add them when a real user asks.

---

## Risks and mitigations

| Risk | Mitigation |
|---|---|
| **Hermes runtime version drift** — Onlook bundles built against Hermes vX won't mount on a binary shipping Hermes vY | Pin React Native version in `apps/mobile-client/package.json`. CI smoke-tests every binary build against the latest fixture bundle from `scripts/seed-expo-fixture.ts` before TestFlight upload. |
| **App Store review** — even TestFlight has rules around remote code execution | Frame the app as "an Onlook workspace viewer" in metadata. Restrict relay host to Onlook-controlled domains by default; the override is gated behind a debug toggle. |
| **Binary size creep** — every Expo module added is 100–500KB | Strict allowlist (Phase 1). Quarterly audit of `SUPPORTED_MODULES.md` against actual usage in shipped Onlook bundles. |
| **Relay ↔ client protocol drift** — relay evolves, old clients break | Version the manifest schema. Manifest includes `protocolVersion`. Client refuses to mount on mismatch with an upgrade prompt. Server keeps N-1 compatibility for 30 days after a bump. |
| **Dual-shell maintenance burden** — supporting both stock Expo Go AND the custom client doubles the test surface | Treat stock Expo Go as the fallback path for users who don't install the custom client. The relay continues to serve Metro-format bundles to Expo Go user-agents and Onlook-format bundles (without the embedded 241KB runtime) to the custom client. Bundle generation in `browser-metro` gains a `target: 'expo-go' | 'onlook-client'` flag. |
| **Reconciler version mismatch** — runtime ships React 19.1.0; user bundle imports react-native-web which pins a different React | Bundle-time check in `browser-metro`: refuse to bundle if `react` is in the user's deps with a different major version than the runtime. Document the pinned versions in `packages/browser-metro/README.md`. |
| **Inspector tap latency on cold runtimes** — first tap after mount can be 100ms+ because Fabric's event handler isn't warm | Pre-warm `findNodeAtPoint` with a synthetic tap on `(-1, -1)` immediately after mount. Cheap, hidden, no UX cost. |

---

## Where this plugs into existing Onlook plans

- **`expo-browser-status.md`** — this plan is the natural successor to "Phase H" of that document. Phase H landed the browser preview SW + frame URL routing. This plan adds the native preview path as a peer to the browser preview path. Both share the same `ExpoBrowserProvider` storage, the same `browser-metro` bundler, and the same CF relay. The user picks "browser preview" (iframe) or "device preview" (custom client) per branch.
- **`expo-browser-bundle-artifact.md`** — defines the IIFE bundle envelope. Phase 2 of this plan is its native consumer. If the envelope changes, this plan changes with it.
- **`expo-browser-relay-manifest.md`** — defines the manifest schema. Phase 3's deep-link handler and version validation are downstream of that document.
- **`spike_b_fabric_mount_result.md` (memory)** — records the Spike B findings that motivated Phase 2's "documented entry point" decision. The custom client makes most of those findings obsolete *for Onlook bundles*, but the memory stays as the historical record of why the client exists.

---

## Definition of done for v1

A user with a TestFlight invite can:
1. Install the Onlook Mobile Client from TestFlight
2. Open Onlook in their browser, open the QR modal in the editor for any branch with `provider_type = 'expo_browser'`
3. Scan the QR with the custom client
4. See their `App.tsx` render on their phone within ~5 seconds of the scan
5. Edit `App.tsx` in the browser, save, and see the change appear on the phone within ~1 second
6. Tap a component on the phone, watch the editor jump the cursor to the right `App.tsx:line:col`
7. Open the in-app dev menu and read live `console.log` output

No `idevicesyslog`, no `idevicescreenshot`, no Mac required, no stock Expo Go install.

That's the bar. Everything in this plan exists to clear it.

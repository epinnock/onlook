# Changelog

All notable changes to the `mobile-client` package are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased] - 2026-04-16

### Phase F — Foundations

#### Added
- MCF1 + MCF2: scaffold `mobile-client` workspace and `mobile-client-protocol` package.
- MCF3–MCF7: populate shared protocol types.
- MCF8 prep: Expo entry, app config, and root component.
- MCF8b: `expo prebuild` iOS tree + CocoaPods install.
- MCF9 + MCF10 + MCF11: CI workflow, Maestro E2E harness, and runtime asset wiring.
- MCF12 + MCF13: scope-guard template and `validate-task` harness.
- Wave 1 prep wrappers: `mobile:build:ios` (xcodebuild) and `mobile:e2e` runner.

#### Changed
- Adopted the `xcode-scribe` pattern for the `pbxproj` hotspot (ADR 2026-04-11).

### Wave 1 — Runtime Bootstrap

#### Added
- MC1.4: `onlook-runtime` evaluates into the Hermes pre-bundle; iOS `.app` wiring.
- MC1.9: `SUPPORTED_MODULES` allowlist.
- MC1.10: `OnlookLogger` iOS implementation.
- MC1.11: `wave1-ios` CI job filled with `validate-mc*.sh` scrapes.
- MC1.4.1: rebrand shell.js `[SPIKE_B]` tag to `[onlook-runtime]`.

#### Fixed
- `bundle-runtime.ts` iOS path and gitignore for runtime artifacts.
- macOS arm64 `bun:test` stdio pipe workaround.

### Wave 2 — JSI Host & Runtime API

#### Added
- MC2.1 + MC2.2: `OnlookRuntime` JSI host skeleton.
- MC2.3: `OnlookRuntimeInstaller` TurboModule (iOS) + ADR.
- MC2.3.1: lock `globalThis.OnlookRuntime`.
- MC2.5: iOS Fabric event bootstrap placeholder.
- MC2.7: `OnlookRuntime.runApplication` C++ impl.
- MC2.8: `OnlookRuntime.reloadBundle` C++ impl.
- MC2.9: `OnlookRuntime.dispatchEvent` C++ impl.
- MC2.11: test asserting `iife-wrapper` emits no top-level ESM.
- MC2.12: real `ONLOOK_RUNTIME_VERSION` exposed via `OnlookRuntime.version`.
- MC2.15: pre-warm `findNodeAtPoint(-1,-1)` after mount.

### Wave 3 — Launcher, Manifests & Live Reload

#### Added
- MC3.3: deep-link parser with Zod validation.
- MC3.4: deep-link handler via React Native `Linking` API.
- MC3.5: `LauncherScreen` landing component.
- MC3.6 + MC3.7: QR scanner screen (`expo-camera`) + barcode → deep-link resolver.
- MC3.8 + MC3.9: recent-sessions store (`expo-secure-store`) + `RecentSessionsList` screen.
- MC3.10: `SettingsScreen` with relay host, clear-cache, and dev-menu toggle.
- MC3.11 + MC3.12: manifest fetcher (Zod) + bundle fetcher (discriminated-union result).
- MC3.13: WebSocket relay client.
- MC3.14: live-reload dispatcher (`bundleUpdate` → reload listeners).
- MC3.15 + MC3.16: version-mismatch screen + compatibility check utility/hook.
- MC3.19: emit `onlook://` deep links in QR payload (web-client).
- MC3.20: app router with custom stack navigator.
- MC3.21: QR-to-mount end-to-end flow.

### Wave 4 — Inspector & Editor Integration

#### Added
- MC4.1: iOS `OnlookInspector` TurboModule registration.
- MC4.2: iOS `captureTap(x, y)` via `nativeFabricUIManager.findNodeAtPoint`.
- MC4.5: iOS `highlightNode(reactTag, color)` — 2pt overlay, 600ms.
- MC4.6: iOS tap event forwarder (`OnlookTapForwarder.mm`).
- MC4.12 + MC4.13: Sucrase `jsx-source` transform with `__source` metadata, wired into the `browser-metro` bundler pipeline.
- MC4.14: JS-side tap handler reads `__source` and posts `onlook:select`.
- MC4.15: editor-side receiver for `onlook:select` (web-client).
- MC4.16: register `mobileInspector` tRPC router (web-client).
- MC4.18: end-to-end inspector flow wiring.
- MC4.19: `wave4-ios` CI job filled with inspector `validate-mc4*.sh` loop.

#### Fixed
- Dropped legacy `[RCTBridge currentBridge]` path in `highlightNode`.

### Wave 5 — Debug Surface

#### Added
- MC5.1: console relay intercepts `console.log/warn/error/info/debug`.
- MC5.3: network inspector fetch patch for debug inspector.
- MC5.4: `XMLHttpRequest` patch in runtime bundle.
- MC5.5: network streamer forwards fetch/XHR entries to relay WS.
- MC5.6: error boundary catches React render errors.
- MC5.7: native JS exception catcher.
- MC5.8: crash overlay UI with "view in editor" CTA.
- MC5.9: dev menu overlay component.
- MC5.10: three-finger long-press dev menu trigger.
- MC5.12: clear-storage dev menu action.
- MC5.13: toggle inspector-overlay dev menu action.
- MC5.14: copy session-ID dev menu action.
- MC5.15: view recent logs dev menu action.
- MC5.16: editor-side dev-panel console stream rendering (web-client).
- MC5.18: `wave5` CI job filled with debug-surface `validate-mc*.sh` loop.

### Wave 6 — Release Engineering

#### Added
- MC6.1: binary version SSOT shared with runtime protocol.
- MC6.2: `cf-expo-relay` emits `extra.expoClient.onlookRuntimeVersion`.
- MC6.3: `browser-metro` README documents `target` flag as canonical public API.
- MC6.4: bundle-time React version guard in `browser-metro`.
- MC6.5: iOS TestFlight build config (`eas.json` + scripts).
- MC6.6: Android Play Store internal-track build config.
- MC6.7: `testflight-upload` CI job, dry-run default, `EXPO_TOKEN`-gated.
- MC6.9: release checklist.

### Wave I — Integration

#### Added
- MCI.1: in-process full-pipeline integration harness.
- MCI.2: binary size audit script + baseline scaffold.

## 2026-04-16 — cron-saturated session close

### Wave 1 — Runtime Bootstrap

#### Added
- MC1.8: Expo module allowlist (ESLint half) to fence imports against `SUPPORTED_MODULES`.

### Wave 2 — JSI Host & Runtime API

#### Changed
- MC2.14: wire `captureAndReport` into MC2.7/2.8/2.9 runtime methods so JSI host failures surface as `onlook:error`.

### Wave 4 — Inspector & Editor Integration

#### Added
- MC4.3: iOS `walkTree` Fabric shadow-tree walker.
- MC4.4: iOS `captureScreenshot` debug-info helper (MC3.18) with capped log buffer.
- MC4.17: Monaco cursor jump driven by `onlook:select` payloads (web-client).

### Wave 5 — Debug Surface

#### Added
- MC5.2: console streamer forwards intercepted entries to the relay WS.
- MC5.17: editor-side mobile network panel (web-client).

### Wave I — Integration

#### Added
- MCI.3: wire `mobile:audit:bundle-size` npm script + hello-onlook fixture + CI gate; bundle size audit + baseline committed.
- MCI.4: `mobile-client-protocol` version SSOT drift test across consumers.

#### Changed
- MCI.2: wire `mobile:audit:size` npm script with `--no-build` flag.

### Follow-ups

- `captureAndReport` contract test asserts `onlook:error` shape end-to-end.
- Fuzz tests for `parseOnlookDeepLink` edge cases.
- CI: unpin iPhone 15 destination — use `generic/platform=iOS Simulator`.
- Docs: install-on-device runbook; task queue synced for 2026-04-16 session.

### Milestone

First successful install verified on a physical iPhone 8 Plus — icon visible on home screen; app boot captured via device syslog, not screen. See [`docs/images/first-install-2026-04-16.png`](docs/images/first-install-2026-04-16.png) and release note [`plans/release-notes/2026-04-16-first-iphone-deploy.md`](../../plans/release-notes/2026-04-16-first-iphone-deploy.md).

iOS side functionally complete; Android deferred behind MCF8c.

## [Unreleased] - 2026-04-22/23

### Phase G — Two-tier overlay pipeline end-to-end validation

#### Added
- **Overlay rendering surface**: `src/overlay/` — `OverlayHost` (sibling of AppRouter in App.tsx), `OverlayErrorBoundary`, `badComponentFilter`, `renderAppBridge`, `overlayHostSubscription`. Subscribable `globalThis.renderApp` pinned via `Object.defineProperty writable:false` against runtime.js clobber (ADR finding #3). Bad-component filter drops `RCTRawText` / `RCTText` / `RCTView` trees (ADR finding #4).
- **Bridgeless WS-receive workaround**: poll-based relay event channel. `src/relay/overlayAckPoll.ts` wraps `@onlook/mobile-preview`'s `startRelayEventPoll`, resolves `OnlookRuntime.httpGet` lazily, and is hooked into `twoTierBootstrap`'s start/stop lifecycle. Phone sends `onlook:overlayAck` via WS.send after mount (TCP write works on bridgeless iOS 18.6 — only receive-side event dispatch is dead, ADR finding #8).
- **Bundle split**: `packages/mobile-preview/runtime/entry-client-only.js` produces `bundle-client-only.js` (8.8 KB vs 257.6 KB `bundle.js`, 96.6% reduction). `scripts/bundle-runtime.ts` defaults to the slim bundle; Expo Go / harness keeps the full bundle.
- **Screenshot-diff CLI**: `scripts/screenshot-diff.ts` with three-tier comparison (hash → perceptual → size fallback). Pure-TS PNG decoder at `scripts/pngDecoder.ts` — no `sharp` dep.
- **qrToMount relayHost fix** (MCG.2): extracts hostname from full manifest URL before passing to `OnlookRuntime.mountOverlay` so shell.js's `_tryConnectWebSocket` synthesises a valid `ws://` URL.

#### Changed
- `index.js` installs a pinned subscribable renderApp + filter + `ReactNative` on globalThis + `__noOnlookRuntime = true` so runtime.js doesn't load on the mobile-client path.
- `src/App.tsx` renders `<OverlayHost />` as a sibling of `<AppRouter />` (not via `AppRegistry.runApplication` which silently no-ops on bridgeless + new-arch, ADR finding #6).
- `src/flow/twoTierBootstrap.ts` calls `sendAck(msg, 'mounted' | 'failed', error?)` after mount; `HmrSession`'s `ONLOOK_OBSERVABILITY_TYPES` already whitelists `onlook:overlayAck` for fan-out to the editor.
- `src/navigation/AppRouter.tsx` routes the previously-declared-but-unhandled `'progress'` screen; added a compile-time exhaustiveness guard.

#### Fixed
- `runtime.js` gate in `packages/mobile-preview/runtime/entry.js` now keys on `!globalThis.__noOnlookRuntime` instead of `typeof window !== 'undefined'` (RN's InitializeCore sets `window = globalThis`, which broke the gate on-device — ADR finding #3).
- `shell.js#_tryConnectWebSocket` defensively strips scheme/port/path from a full-URL `host` argument before synthesising `ws://<host>:<port>`.
- Pre-existing `bundle-execution.test.ts` RN$AppRegistry expectation corrected (shell.js unconditionally installs the shadow; no Hermes gate exists).

#### Tests
- **447 mobile-client tests** (was 403), +42 new in `src/overlay/__tests__/` covering renderApp bridge, error boundary, filter, subscription, fake-runtime integration, pin-regression.
- Sibling packages: cf-expo-relay **197** (+events DO + events route + cross-layer integration), mobile-preview 94 (+stripWsHost + relayEventPoll + bundle-client-only exec), mobile-client-protocol 98 (+relay-events union), browser-bundler 157 (+wrap-overlay-v1 circular-import), web-client dev-panel adds `MobileOverlayAckTab` + `OverlayPreflightPanel`.

### Milestone

**Photographic evidence end-to-end on Xcode 16.4 on mini's iPhone 16 sim** — rebuilt IPA from current source, deep-link `onlook://launch?session=…&relay=http://…/manifest/<hash>` cold-launches the app, qrToMount parses → fetches manifest → fetches bundle → `OnlookRuntime.mountOverlay` → renderApp → `OverlayHost` renders **"Hello, Onlook!"** (blue) at t+400ms → **"UPDATED via v2!"** (green) at t+7000ms.

Screenshots:
- `plans/adr/assets/v2-pipeline/post-g-launcher.png`
- `plans/adr/assets/v2-pipeline/post-g-hello.png`
- `plans/adr/assets/v2-pipeline/post-g-updated.png`

ADRs shipped:
- `plans/adr/v2-pipeline-validation-findings.md` — 8 findings from simulator validation
- `plans/adr/overlay-host-architecture.md` — OverlayHost-in-App.tsx decision
- `plans/adr/cf-expo-relay-events-channel.md` — /events wire contract

## [Unreleased] - 2026-04-25 — Phase 11b prep + tap-to-source

A 54-commit autonomous session (PR #20) shipped four interrelated workstreams. Mobile-client commits below; full session map in `MEMORY.md`'s `project_session_2026_04_25.md`.

### Added
- **`src/relay/abiHello.ts`** (`b3d7e769`): `buildPhoneAbiHello` builder mirroring the editor-side `buildEditorAbiHello`. Produces a `role: 'phone'` AbiHelloMessage from supplied RuntimeCapabilities.
- **`OnlookRelayClient.abiHelloProvider` option** (`b2bb133c`): canonical-class WS client now fires the AbiHello on every WS open via a caller-supplied provider. Wraps both the build + send in try/catch — a hello-send failure cannot wedge the WS; the editor's gate just stays `'unknown'` (fail-closed).
- **AppRouter Spike B WS path fires AbiHello** (`e6237acd`): the production WS workaround that bypasses `OnlookRelayClient` (see `project_approuter_spike_b_ws.md` memory) was wired separately so the handshake actually works in today's binary.
- **`useDeepLinkHandler` wired into AppRouter** (`f8d70396`): `onlook://launch?session=…&relay=…` now auto-routes through the URL pipeline on cold/warm-start. The handler module existed but no production caller consumed it.
- **`buildDeepLinkPipelineUrl` helper** (`f8d70396`): pure helper for canonical-URL reconstruction; covered by 7 unit tests round-tripping through the deep-link parser.
- **CodeMirror-native tap-to-source path** (`9eda7ddb` + `47a01022`): new `IdeManager.openCodeLocation(fileName, line, column)` method drives the existing `_codeNavigationOverride` MobX state. `wireOnlookSelectToIdeManager(ide)` glue helper wired in `Main`'s `useEffect` so phone taps land on the editor's CodeMirror `EditorView` via the same path `openCodeBlock` uses.

### Removed
- **Stale Monaco-shaped helper** (`2be936c8`): `wireCursorJump.ts` + `monacoCursorJump.ts` + their test file — the codebase uses CodeMirror's `EditorView`, not Monaco, so the helper could never have fired. Replaced by the CodeMirror-native path above.

### Tests
- **+34 mobile-client tests** (471 total): new coverage at `abiHello.test.ts` (7 tests), `buildDeepLinkPipelineUrl.test.ts` (7 tests), `wireOnlookSelectToIdeManager.test.ts` (6 tests), `openCodeLocation.test.ts` (9 tests; documented MobX class-stub-vs-object-literal quirk inline), plus AbiHello mock additions across `AppRouter-mount-overlay.test.ts` + `extract-relay-host-port.test.ts` + `buildDeepLinkPipelineUrl.test.ts`.

### Documentation
- v2 task queue rows #35, #85, #89-94 updated; mobile-client task queue MC4.17 (CodeMirror-native shipped), MC4.18 (precondition unblocked), MC2.5 (validate note refreshed).
- ADR-0009 (Phase 11) updated with the safety-chain shipped status.
- 4 new memory files capture durable lessons (audit pattern, MobX stub quirk, CodeMirror not Monaco, AppRouter Spike B WS bypass).

## [Unreleased] - 2026-04-25 — observability wiring (workstream F continued)

### Added
- **`src/relay/wsSender.ts`**: process-wide registry that bridges AppRouter's Spike B raw WS (production) to observability streamers (ConsoleStreamer, future NetworkStreamer/ExceptionStreamer) that were previously typed against the dead-on-arrival `OnlookRelayClient`. Exposes `WsSenderHandle` interface (`isConnected` getter + `send(msg)`), `register/unregister/getActive` operations, and `dynamicWsSender` — a stable handle whose calls always delegate to the latest registered sender. Streamers hold `dynamicWsSender` for their lifetime; the registry handles WS reconnects transparently. 11 unit tests.
- **AppRouter Spike B WS now registers itself**: `ws.onopen` calls `registerActiveWsSender({get isConnected() {...}, send(msg) {...}})` adapter; `ws.onclose` calls `unregisterActiveWsSender()`. Both wrapped in try/catch — a registry mishap must not wedge the WS.
- **App.tsx wires ConsoleStreamer at boot**: instantiates `new ConsoleStreamer(dynamicWsSender, 'pending')` after `consoleRelay.install()`, calls `start()` so console patches install once at app boot. Pre-WS-open entries buffer locally on the streamer; they drain on the next forward call after AppRouter registers a sender. Deeplink resolution rotates the session id stamp via `consoleStreamerRef.current?.setSessionId(result.sessionId)`.

### Changed
- **`ConsoleStreamer` constructor type** widened from concrete `OnlookRelayClient` class to structural `WsSenderHandle` (audit-pattern fix). Closes the unwired-streamer gap documented at MC5.2 — the editor's `MobileConsoleTab` now receives entries on a real session. Added `setSessionId(id)` setter so the streamer is reused across deeplink-rotated sessions without re-patching console.

### Tests
- **+11 mobile-client tests** (482 total, was 471): `wsSender.test.ts` covering register/unregister/replace, `dynamicWsSender` connectivity reflection, send delegation including the latest-wins case after replacement, and throw-on-empty-registry. Existing `ConsoleStreamer` tests pass unchanged — the structural cast in the test fake is now redundant but harmless.

### Documentation
- mobile-client task queue MC5.2 status updated from "Done (primitive only — production wiring NOT shipped)" to "Done (production-wired via wsSender registry)" pending follow-up commit. NetworkStreamer (MC5.5) wiring deferred — needs fetch/xhr patch installation.

## [Unreleased] - 2026-04-25 — ExceptionStreamer wiring (workstream F continued)

### Added
- **`src/debug/exceptionStreamer.ts`**: pairs to ConsoleStreamer — subscribes to `exceptionCatcher.onException` (MC5.7) and forwards each captured exception as an `onlook:error` wire message via `WsSenderHandle`. Maps `ExceptionEntry` → `ErrorMessage` shape, promoting kind to `'react'` when `componentStack` is present (ErrorBoundary captures). Disconnect-resilient: 50-entry local buffer drains opportunistically on the next successful send. 8 unit tests covering forward shapes, kind promotion, disconnect/throw buffering, sessionId rotation, idempotent start, stop unsubscribe, and 50-cap drop-oldest behavior.
- **App.tsx wires ExceptionStreamer alongside ConsoleStreamer**: `exceptionCatcher.install()` patches `globalThis.ErrorUtils.setGlobalHandler` + `window.onerror`; ExceptionStreamer subscribes via `dynamicWsSender` and forwards via the same shared registry. Closes the producer half of the source-map decoration chain — the editor's `wireBufferDecorationOnError` (use-mobile-preview-status.tsx, wired via 5da582fe + 3b18789d) was correctly receiving but had no producer until now.

### Tests
- **+8 mobile-client tests** (490 total, was 482): `exceptionStreamer.test.ts`.

### Documentation
- mobile-client task queue MC5.7 status updated to reflect production-wired state.

## [Unreleased] - 2026-04-25 — NetworkStreamer wiring (workstream F continued)

### Changed
- **`NetworkStreamer` constructor type** widened from concrete `OnlookRelayClient` to structural `WsSenderHandle` — same pattern as ConsoleStreamer (`6a6ceba0`). MC5.5 production wiring closed.

### Added
- **App.tsx wires fetch/XHR patches + NetworkStreamer at boot**: `fetchPatch.install()` + `xhrPatch.install()` patch the global prototypes once at boot; `new NetworkStreamer(dynamicWsSender, {}, {sessionId: 'pending'})` + `start()` subscribes to both patch sources and forwards completed entries as `onlook:network` messages via the shared registry. Cleanup teardown calls `uninstall()` on both patches so fast-refresh / unit-test re-mounts don't double-patch. Deeplink resolve rotates the session id via `networkStreamerRef.current?.setSessionId(result.sessionId)`.

### Tests
- mobile-client total stays at 490 (no new tests this commit — NetworkStreamer's existing 12 tests already cover the structural contract; the wire-in is one-line additions to App.tsx that don't add new behavior).

### Documentation
- mobile-client task queue MC5.5 status updated to reflect production-wired state. With this, **all three observability streamers (MC5.2 console, MC5.5 network, MC5.7 exceptions) are now production-wired** via the `dynamicWsSender` registry pattern — closes the entire mobile-client observability gap documented in `8c52ebf4`. TapHandler (MC4.14) remains gated on `findNodeAtPoint` (MC4.2, doesn't exist) — separate work.

## [Unreleased] - 2026-04-25 — DevMenu wiring (workstream F continued)

Audit-pattern catch #10: the entire mobile-client DevMenu surface (MC5.9 component + MC5.10 trigger gesture + MC5.11 reload action + MC5.12 clear-storage action + MC5.13 view-logs action) was shipped as primitives but never instantiated/rendered in production. Three-finger long-press did nothing; the modal was unreachable.

### Added
- **App.tsx wires the DevMenu surface end-to-end**:
  - `DevMenuTrigger` wraps `<AppRouter />` + `<OverlayHost />` so a three-finger long-press anywhere opens the modal. The wrapper is transparent — children render normally; the App.composition test guard now permits transparent wrappers as long as AppRouter remains an immediate JSX sibling of OverlayHost.
  - `DevMenu` modal renders 5 actions composed via the existing factories (`createReloadAction`, `createCopySessionIdAction(getSessionId)`, `createViewLogsAction(setVisible)`, `createToggleInspectorAction()`, `createClearStorageAction()`). Each action's `onPress` is wrapped to auto-dismiss the menu after firing.
  - `RecentLogsModal` mounts as a sibling of the trigger so it persists after the dev menu dismisses (the View Recent Logs action sets visible=true; the modal owns its own onClose dismissal).
  - `activeSessionIdRef` tracks the resolved session id from deeplink resolve so `createCopySessionIdAction` reads the latest value via closure.

### Changed
- **App.composition.test.ts** widened to permit transparent wrappers (previously required `<><AppRouter /><OverlayHost /></>` exactly; now allows any wrapper provided AppRouter is the immediate JSX sibling of OverlayHost). The architectural invariant is preserved (no nesting; both elements span every screen).

### Tests
- mobile-client total stays at 490 (no new tests; existing `DevMenu.test.ts`, `DevMenuTrigger.test.ts`, action factory tests, and the widened composition guard cover the wiring contract).

### Documentation
- mobile-client task queue MC5.9–MC5.13 statuses follow up in a separate commit.

### Known limitations
- `createToggleInspectorAction` toggles a global boolean but the inspector overlay UI itself isn't wired — same root cause as TapHandler (gated on `findNodeAtPoint` / MC4.2 unimplemented). The action runs without error but produces no visible effect today.

## [Unreleased] - 2026-04-25 — DevMenu / Settings sync (workstream F continued)

Closes the previous tick's documented gap: SettingsScreen had a `dev_menu_enabled` toggle that wrote to SecureStore, but App.tsx's DevMenuTrigger ignored it (always armed). Now both sides observe the same in-memory state so a settings toggle takes effect immediately without an app restart.

### Added
- **`src/storage/devMenuEnabled.ts`**: in-memory observable + SecureStore persistence for the `onlook_dev_menu_enabled` key. Mirrors the `actions/toggleInspector.ts` Set-based listener pattern; default is OFF (matching SettingsScreen UX). Exposes `loadDevMenuEnabled()`, `setDevMenuEnabled()`, `isDevMenuEnabled()`, `onDevMenuEnabledChange()`. 11 unit tests covering load/persist/notify/unsubscribe paths with an in-memory expo-secure-store mock.

### Changed
- **App.tsx** subscribes to `onDevMenuEnabledChange` and passes `disabled={!devMenuTriggerEnabled}` to `<DevMenuTrigger>` so the gesture is gated on the user setting.
- **SettingsScreen.tsx** uses the shared module instead of inline SecureStore calls. The toggle now goes through `setDevMenuEnabled(value)` which fires both the persistence write AND the in-memory observable. Subscribes to `onDevMenuEnabledChange` so external state changes (e.g. future dev-menu actions) sync the local UI state.

### Tests
- **+11 mobile-client tests** (501 total, was 490): `devMenuEnabled.test.ts` covering default value, load returns absent/true/false, set persists + notifies, unchanged-value short-circuit, listener unsubscribe, multiple listeners.

## [Unreleased] - 2026-04-25 — RecentSessionsList wiring (workstream F continued)

Audit-pattern catch #11: `RecentSessionsList` (MC3.9, 177 LOC + tests) was authored 2026-04-16 but had ZERO production consumers. LauncherScreen even reserved a "Recent sessions" section that just rendered an empty placeholder `<View>`. So sessions persisted by `qrToMount` (via `addRecentSession`) accumulated in SecureStore but were never displayed.

### Added
- **LauncherScreen renders RecentSessionsList** in the existing `recentSection` placeholder slot. New optional `onRecentSessionSelect` prop receives the tapped row's `RecentSession`; AppRouter wires it to construct an `onlook://launch?session=…&relay=…` deep-link and route through `buildUrlPipelineRunner(actions)` — same path as a fresh QR scan, so re-mounting goes through `parseOnlookDeepLink` → `qrToMount` end-to-end.
- **`storage/recentSessions.ts` change-listener pattern**: `onRecentSessionsChange(handler)` subscription. Both `addRecentSession` and `clearRecentSessions` notify after persistence. Mirrors the `devMenuEnabled` observable. Without this, AppRouter's screen-stack reuses the LauncherScreen instance across navigation, so new sessions added via QR scan + back wouldn't surface — `useEffect`'s mount fetch would only fire once.
- **`RecentSessionsList` subscribes to the new change-listener** so the launcher refreshes automatically after every `addRecentSession` / `clearRecentSessions`. Re-fetches via `getRecentSessions()` and updates state; safe across the unmount cleanup race via the existing `cancelled` flag.

### Tests
- **+5 mobile-client tests** (506 total, was 501): `recentSessions.test.ts` adds coverage for `onRecentSessionsChange` — fires after add + clear, unsubscribe stops further notifications, multi-listener fan-out, and throw-isolation (one bad listener doesn't block others or the underlying write).

## [Unreleased] - 2026-04-25 — ErrorBoundary at App root + render-error → exceptionCatcher bridge

Audit-pattern catch #12: `ErrorBoundary` (MC5.6, 89 LOC + tests) was shipped 2026-04-16 but had ZERO render sites in production. Without it, a thrown render in any descendant of `<App>` (overlay component, AppRouter screen, DevMenu, etc.) crashed the JS bundle with an RN red-box rather than rendering the friendly ErrorScreen fallback OR forwarding to the editor.

### Added
- **App.tsx wraps its tree in `<ErrorBoundary>`**. Default fallback (`ErrorScreen` with retry) handles the local UX. The `onError` callback bridges into `exceptionCatcher.captureException(err, componentStack)` so React render errors land in the same ring buffer + listener fanout that `ExceptionStreamer` (25da7d27) consumes to ship `onlook:error` messages to the editor's source-map decoration receive-chain. Without this bridge, a thrown render would render the local fallback but never reach the editor's MobileNetworkTab/console panels.

### Tests
- mobile-client total stays at 506 (no new tests; `ErrorBoundary.test.ts` covers the boundary's contract and `App.composition.test.ts`'s widened guard already accepts the wrapping). Existing 506 tests all pass.

## [Unreleased] - 2026-04-25 — overlay error → exceptionCatcher bridge (workstream F continued)

`reportOverlayBoundaryError` (the OverlayHost-level error sink) routed only through `OnlookRuntime.reportError` (a JSI binding). When the native binding wasn't installed (or in any path that didn't invoke it), overlay React render errors had no path to the editor. Belt-and-suspenders fix: also forward through `exceptionCatcher.captureException(error)` so the JS-only ExceptionStreamer (25da7d27) → onlook:error → editor source-map decoration chain fires regardless of native-binding availability.

Same shape as `bf3f43e7`'s App-root ErrorBoundary bridge, applied at the per-overlay boundary. Both roots — App and Overlay — now feed the same exceptionCatcher pipeline. Existing 5 reportOverlayBoundaryError tests pass unchanged (their assertions are scoped to the OnlookRuntime.reportError side-effect; the new captureException call doesn't disturb them).

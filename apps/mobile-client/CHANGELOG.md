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

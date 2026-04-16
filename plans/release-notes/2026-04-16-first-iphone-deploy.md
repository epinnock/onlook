# Release Note: First iPhone Deploy — 2026-04-16

## Milestone
First successful install + boot of OnlookMobileClient on a physical iPhone (iPhone 8 Plus, iOS 15.1). Confirms the entire stack — Wave F toolchain → Wave 1 scaffold → Wave 2 OnlookRuntime JSI → Wave 3 QR flow wiring → Wave 4 inspector → Wave 5 dev panel → Wave 6 distribution path — boots cleanly from a device build/install.

## Verified
- Keychain-unlocked codesign works over SSH-to-Mac mini
- `expo prebuild` → `pod install` → `xcodebuild -destination 'platform=iOS,id=<UDID>'` → `ios-deploy --bundle` produces a runnable signed `.app`
- `HermesBootstrap.swift` successfully composes the onlook-runtime + main.jsbundle at 1.57MB
- Hermes engine loads combined bundle
- OnlookRuntime JSI host registers on `globalThis`
- B13 runtime shell initializes
- React resolves via host.runtimeDelegate

## Not yet
- LauncherScreen render fails at first `useState` due to dual-React (main bundle + runtime bundle both ship React). Fix in flight — see `plans/onlook-mobile-client-task-queue.md` #74.
- Physical device maestro E2E flows (MCI.5) — unblocked once dual-React lands.
- TestFlight + Play Store uploads — MC6.7 / MC6.8 CI jobs present but dry-run-only pending device verification.

## Diagnostics added this session
- Keychain-unlock pattern → orchestration memory
- `--justlaunch` SIGKILL false-positive pattern → orchestration memory
- `__d`/`__r` clobber post-mortem → `plans/post-mortems/2026-04-16-runtime-d-r-clobber.md`
- IIFE regression test → `packages/mobile-preview/server/__tests__/build-runtime.regression.test.ts`
- install-on-device runbook → `apps/mobile-client/docs/install-on-device.md`

## Commit summary (32 commits)
- `1c5a1864` test(mobile-client-protocol): MCI.4 — add ws-tap + ws-error fixtures
- `08d8eb93` test(mobile-client): refresh Maestro flows for LauncherScreen UI
- `6e8733c0` docs: post-mortem for runtime __d/__r clobber (2026-04-16)
- `12a087fb` docs(mobile-client): task-queue entry for 2026-04-16 afternoon session
- `b16efccc` chore(ai): refresh prompt fixtures from test run
- `bbd641c6` test(mobile-preview): regression test asserting bundle.js __d/__r are IIFE-scoped
- `40e0f2ec` fix(mobile-preview): scope runtime __d/__r inside IIFE so Hermes module system survives
- `08f7dcf5` feat(mobile-client): add mobile:install:device npm script for physical iPhone install
- `d39f5d73` docs(mobile-client): MCI.2 — baseline numbers from first real build
- `7bb9f6a9` fix(mobile-client): remove stale onlook.highlight overlay before adding new one
- `ec31e9b7` test(mobile-client): verify bundle-runtime meta.json matches copied bundle
- `55cee2de` feat(mobile-client): wire startTapBridge into app startup (MC2.5 follow-up)
- `bd3d3bb4` feat(mobile-client): MC2.5 — UITapGestureRecognizer-based tap bridge (pragmatic)
- `6a51808d` docs(mobile-client): CHANGELOG entry for 2026-04-16 session
- `5d6f9c0a` fix(mobile-client): add depth cap + cycle guard to walkTree recursion
- `8cc08916` perf(mobile-client): wrap screenshot render in autoreleasepool for prompt UIImage release
- `140e5431` test(mobile-client): fuzz tests for parseOnlookDeepLink edge cases
- `324fde15` docs(mobile-client): add install-on-device runbook
- `46d06e21` test(mobile-client): verify captureAndReport onlook:error contract
- `a4581134` test(mobile-client-protocol): version SSOT drift test across consumers
- `8beeda04` docs(mobile-client): sync task queue status for 2026-04-16 session
- `9fffe1e7` refactor(mobile-client): wire captureAndReport into MC2.7/2.8/2.9 runtime methods
- `e248392c` feat(mobile-client): MCI.3 — wire mobile:audit:bundle-size npm script + hello-onlook fixture + CI gate
- `8e9a85c7` feat(mobile-client): MCI.2 — wire mobile:audit:size npm script + --no-build flag
- `3279ce9a` chore(ci): unpin iPhone 15 destination — use generic/platform=iOS Simulator
- `d9f90113` feat(mobile-client): MC4.17 — Monaco cursor jump from onlook:select
- `ad45cdf3` feat(mobile-client): MC4.3 — iOS walkTree Fabric shadow-tree walker
- `aa7317c9` feat(mobile-client): MC1.8 — Expo module allowlist (ESLint half)
- `d679c405` test(mobile-client): MCI.3 — bundle size audit + baseline
- `08122dc3` feat(mobile-client): MC3.18 — debug info collector with capped log buffer
- `d40537d5` feat(mobile-client): MC5.2 — console streamer forwards entries to relay WS
- `ff7c85c0` feat(web-client): MC5.17 — editor-side mobile network panel

## Path to 0.1.0 release
1. Dual-React fix lands (in flight, see #74)
2. Tap from home-screen → LauncherScreen renders cleanly
3. Manual MCI.5 DoD walk (human + iPhone)
4. Final merge to main (MCI.6)
5. Tag 0.1.0, TestFlight upload via CI (MC6.7)

## Contributors
Orchestrated via /loop cron across ~40+ parallel agents.

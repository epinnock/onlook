# Onlook Mobile Client — new-developer onboarding

Target: RN-familiar developer, fresh macOS with Xcode + Node. ~30 min to first iPhone install.

## Prereqs
- macOS with Xcode 16.1+ (`xcode-select -p`)
- Bun 1.3.9+ (`bun --version`)
- CocoaPods 1.16+ (`pod --version`)
- Physical iPhone (iOS 15.1+) OR iOS simulator
- Apple Developer team for signing (or use free provisioning profile)

## 1. Clone + install (2 min)
```bash
git clone https://github.com/onlook-dev/onlook.git
cd onlook
git checkout feat/mobile-client   # until merged to main
bun install
```

## 2. Build the runtime bundle (30s)
```bash
bun run build:mobile-runtime
# Output: packages/mobile-preview/runtime/bundle.js (~257KB, gitignored)
```

## 3. Bundle + prebuild for iOS (2 min)
```bash
cd apps/mobile-client
bun run bundle-runtime                # copies runtime into ios/Resources/
bun x expo prebuild --platform ios    # regenerates ios/ from app.config.ts
cd ios && pod install && cd ..
```

## 4. First-time signing (5 min, Xcode GUI only)
```bash
open ios/OnlookMobileClient.xcworkspace
```
Then in Xcode:
- Select the `OnlookMobileClient` target
- Signing & Capabilities → Team: pick yours
- Bundle Identifier: `com.onlook.mobile` (or change if you can't claim it)

## 5. Install to device or simulator
### Simulator
```bash
bun run mobile:build:ios
# Builds + installs; launches in the booted simulator
```

### Physical iPhone (over SSH — see mac-mini-debugging.md for details)
```bash
brew install ios-deploy
xcrun xctrace list devices            # find your UDID
bun run mobile:install:device -- --device=<UDID>
# or: ONLOOK_DEVICE_UDID=<UDID> bun run mobile:install:device
```

## 6. Confirm boot
Stream logs while the app runs:
```bash
# simulator
xcrun simctl spawn booted log stream --predicate 'process == "OnlookMobileClient"' | grep '[onlook-runtime]'
# device
idevicesyslog -u <UDID> -p OnlookMobileClient | grep '[onlook-runtime]'
```
Expected sequence:
- `[onlook-runtime] hermes ready`
- `[onlook-runtime] composed combined bundle (X bytes)`
- `[onlook-runtime] OnlookRuntime installed on globalThis`
- `[onlook-runtime] B13 shell ready`

### 6a. JS-side diagnostics via `__onlookDirectLog`

React Native's `globalThis.nativeLoggingHook` is overwritten by the
bridgeless init path sometime after our TurboModule installer runs
(verified on iOS 18.6 sim 2026-04-21). As a result, JS code that calls
`globalThis.nativeLoggingHook(...)` directly will silently drop its
messages once RN's own routing takes over.

To work around this, the native `OnlookRuntimeInstaller` (see
`cpp/OnlookRuntimeInstaller.cpp`) ALSO publishes a **private**
`globalThis.__onlookDirectLog(message, level)` channel that nothing
else in the system touches. It routes to `os_log` on iOS and
`__android_log_print` on Android, prefixed with `[onlook-js]` so the
log-stream predicate above catches it.

**Prefer `__onlookDirectLog` over `nativeLoggingHook` in JS** whenever
you need reliable sim-visible diagnostics. The pattern used across
the codebase (manifestFetcher's `nlog`, bundleFetcher's `blog`,
AppRouter's `_pipelineLog`):

```ts
try {
  const gt = globalThis as unknown as {
    __onlookDirectLog?: (m: string, level: number) => void;
    nativeLoggingHook?: (m: string, level: number) => void;
  };
  const channel = gt.__onlookDirectLog ?? gt.nativeLoggingHook;
  channel?.(`[my-module] ${msg}`, 1);
} catch { /* diagnostic path must never throw */ }
```

Output appears in `log stream` like:

```
... OnlookMobileClient.debug.dylib [onlook-js] [my-module] your message
```

Filter with `grep onlook-js` on the log-stream command for a clean
view of JS-originated breadcrumbs only.

## 7. Run tests
```bash
# Protocol package has a dedicated test script
bun --filter @onlook/mobile-client-protocol test

# Mobile-client script-level tests (bun's built-in runner picks up __tests__)
cd apps/mobile-client && bun test
```
(`@onlook/mobile-client` and `@onlook/browser-metro` do not expose a `test`
script yet — run `bun test` in-directory or rely on the monorepo root
`bun run test` which filters for packages that declare one.)

## Where things live
- `apps/mobile-client/` — iOS app (Expo + RN)
- `apps/mobile-client/cpp/` — C++ JSI host objects (OnlookRuntime + OnlookInspector)
- `apps/mobile-client/ios/OnlookMobileClient/` — Obj-C++ glue (HermesBootstrap, OnlookLogger, Fabric bridge)
- `apps/mobile-client/src/` — TypeScript (flows, screens, relay client)
- `packages/mobile-preview/` — runtime bundle source (B13 shell)
- `packages/mobile-client-protocol/` — wire schemas (Zod)
- `packages/browser-metro/` — Metro target/transform layer

## Deep dives
- `apps/mobile-client/docs/install-on-device.md` — full install flow + troubleshooting
- `apps/mobile-client/docs/mac-mini-debugging.md` — remote debugging playbook
- `apps/mobile-client/docs/combined-bundle-format.md` — how the runtime + user bundle combine
- `plans/onlook-mobile-client-plan.md` — architecture + DoD
- `plans/onlook-mobile-client-task-queue.md` — task-level status

## When you're stuck
- Check orchestration memory for known gotchas (SIGKILL false positives, keychain unlock, DNS flaps)
- Bridgeless new-arch (`newArchEnabled: true`) means no RCTBridge; see MC1.4 status for details
- Hermes + combined-bundle line numbers: see combined-bundle-format.md

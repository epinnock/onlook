# ADR: TurboModule install pattern for `globalThis.OnlookRuntime` registration

**Status:** accepted (2026-04-15)
**Context for:** MC2.3 (iOS), MC2.4 (Android, deferred) of `plans/onlook-mobile-client-task-queue.md`
**Depends on:** MC2.1 + MC2.2 (the OnlookRuntime header + skeleton, shipped in `de493a11`); ADR `plans/adr/MC1.4-MC2.10-runtime-context.md` (single Hermes context model)

## Context

MC2.1 + MC2.2 shipped `OnlookRuntime`, a `facebook::jsi::HostObject` subclass. To make user JS code able to call `OnlookRuntime.runApplication(bundleSource)`, this host object has to be registered on the JS global, i.e.:

```cpp
runtime.global().setProperty(
    runtime,
    "OnlookRuntime",
    jsi::Object::createFromHostObject(runtime, std::make_shared<onlook::OnlookRuntime>()));
```

This requires a `jsi::Runtime&` reference, accessed at a moment **after** Hermes initializes but **before** the user bundle starts evaluating user-authored code that might read `OnlookRuntime`.

Earlier exploration during MC1.4 established three things:

1. **Bridgeless / new arch (our config: `newArchEnabled: true`)** uses `RCTHost` rather than `RCTBridge`. `RCTHost` loads the bundle directly from the URL returned by the delegate's `bundleURL()` and never calls the legacy `loadSourceForBridge:` or `loadBundleAtURL:` delegate hooks. Empirically verified: `NSLog`s in both fired only on `bundleURL()`.
2. **Expo's `ExpoReactNativeFactory` does not expose its inner `RCTHost`.** The factory holds it privately on its `rootViewFactory` and only surfaces it through KVC paths like `rootViewFactory.value(forKey: "reactHost")`. `RCTHost` does have a public `runtimeDelegate` property (with a `host:didInitializeRuntime:(jsi::Runtime&)` callback), but the factory creates and starts the host before the app delegate can reach in to set the delegate, so by the time KVC succeeds, `didInitializeRuntime` has already fired and our delegate misses the call.
3. **Swift cannot bridge `jsi::Runtime&` directly.** Any code that handles the runtime reference has to be Objective-C++ (`.mm`) or C++.

The runtime JS (`packages/mobile-preview/runtime/shell.js`) does not install `globalThis.OnlookRuntime` either — verified by grep. So a JS-only fallback is not available.

We need a hook that (a) gives us a `jsi::Runtime&` (b) at a moment we control (c) deterministically before user code reads `OnlookRuntime`.

## Decision

**Implement `OnlookRuntimeInstaller` as a TurboModule whose `install()` method registers the host object. Call it from `runtime/shell.js` (the first JS that evaluates after MC1.4's prepend) so the registration happens before any user bundle code runs.**

The TurboModule pattern is the official RN bridgeless-mode mechanism for JSI host installation. It is the same pattern used by react-native-mmkv, react-native-reanimated, and other libraries that need to install JSI host objects on `globalThis` under the new arch. Expo SDK 54 supports it via the standard codegen plus hand-written C++/Obj-C++ TurboModules.

### Why TurboModule, not the alternatives

- **`RCTHostRuntimeDelegate.didInitializeRuntime`** — first choice on paper, fails in practice because Expo's factory creates `RCTHost` privately. We'd have to fork or swizzle Expo to set the delegate before host start; high blast radius for negligible gain.
- **`RCTJSRuntimeConfiguratorProtocol.createJSRuntimeFactory`** — wired by Expo's factory (`configuration.jsRuntimeConfiguratorDelegate = delegate`) and gets called during `RCTHost` init. Returns an opaque `JSRuntimeFactoryRef`, not a `jsi::Runtime&`. The factory creates the runtime later inside RCTHost; we don't get a chance to install host objects from this hook unless we also subclass the factory implementation, which means importing private RCTHost internals. Not worth it.
- **JS-only install** — `runtime/shell.js` could install a pure-JS object on `globalThis.OnlookRuntime`. Loses the native code path entirely (every method becomes a thrown error), and the C++ work in MC2.1/MC2.2 is wasted. Defeats the purpose of Wave 2.
- **Swizzling `RCTHost`** — works but coupling to internal RN classes. Brittle across RN minor versions. Dispreferred.

TurboModule is the supported, version-stable, official pattern.

## What MC2.3 will deliver

### Files

```
apps/mobile-client/cpp/
  OnlookRuntimeInstaller.h          NEW — TurboModule interface declaration
  OnlookRuntimeInstaller.cpp        NEW — install() impl that creates the
                                          OnlookRuntime host object and sets
                                          it on runtime.global()
  OnlookRuntimeInstaller.mm         NEW — Obj-C++ wrapper that conforms to
                                          the RN TurboModule protocol and
                                          delegates to the C++ class
                                          (so the module is reachable from
                                          NativeModules in JS)
apps/mobile-client/ios/OnlookMobileClient/
  OnlookRuntimeInstallerProvider.swift
                                    NEW (or .mm) — registers the TurboModule
                                          with the Expo / RN module registry
                                          via the RCTAppDependencyProvider
                                          extension point
packages/mobile-preview/runtime/
  shell.js                          MODIFIED — add a top-of-file
                                          `require('react-native').NativeModules.OnlookRuntimeInstaller.install()`
                                          (or equivalent TurboModule call)
                                          so install runs before any other
                                          JS executes
apps/mobile-client/ios/OnlookMobileClient.xcodeproj/project.pbxproj
                                    MODIFIED — register the new TUs in the
                                          Sources build phase (xcodeproj
                                          Ruby gem, same template as MC1.10
                                          / MC2.2)
```

### Validate

`bash apps/mobile-client/scripts/validate-mc23.sh` — same shape as
`validate-mc14.sh` (build → install → launch → log scrape), but the
assertion is that the device log contains the line emitted by
`OnlookRuntimeInstaller::install` confirming successful registration
(e.g. `[onlook-runtime] OnlookRuntime installed on globalThis`). Maestro
flow `04-global-present.yaml` from the queue's MC2.3 entry remains the
canonical Wave-2 validate but currently hangs (per `validate-mc14.sh`
note); use the log-scrape variant until a renderable user bundle exists.

## Consequences

### What this gives up

- **Touches `runtime/shell.js`.** Per the orchestration memory, the runtime is currently a Spike B artifact. Adding a `NativeModules.OnlookRuntimeInstaller.install()` line at the top means the runtime now has a hard dependency on the TurboModule existing under the host. Acceptable: we own both sides. Document the dependency in shell.js.
- **A new translation unit for a single one-shot install method** is some boilerplate. Acceptable cost — TurboModule is the supported pattern and we'll likely add more JSI host objects in future waves (relay client, inspector, etc.) that can share the same provider.

### What this gains

- **Deterministic install order.** The install fires from the first line of the runtime, which is the first thing Hermes evaluates after MC1.4's prepend. Guaranteed before any user code runs.
- **Same pattern works on Android.** When MCF8c lands, the MC2.4 Android installer is the same TurboModule with a JNI binding instead of an Obj-C++ wrapper. The C++ install logic is platform-neutral.
- **Standard, well-traveled path.** Future maintainers reading the code see "this is just a TurboModule that installs a JSI host object" — a recognizable pattern, not a bespoke hack.

## Pointers

- OnlookRuntime header / skeleton: `apps/mobile-client/cpp/OnlookRuntime.{h,cpp}` (commit `de493a11`).
- Expo factory wiring: `node_modules/expo/ios/AppDelegates/ExpoReactNativeFactory.swift` (where `configuration.jsRuntimeConfiguratorDelegate` and friends are set up).
- RN TurboModule public headers under `apps/mobile-client/ios/Pods/Headers/Public/ReactCommon/` (`RCTTurboModule.h`, `TurboModule.h`).
- Reference implementation pattern: react-native-mmkv's `MmkvHostObject.cpp` + `MmkvNativeModule.mm` + JS-side `install()` call.

## Follow-ups (not part of MC2.3)

- **Lock `globalThis.OnlookRuntime`** with `Object.defineProperty(..., { writable: false, configurable: false })` so user code can't replace it. Tracked as a follow-up to MC2.3 once the install is in.
- **MC2.4 Android installer** — same TurboModule, JNI wrapper instead of Obj-C++. Lands when MCF8c is active.
- **JS-side type definitions** for `globalThis.OnlookRuntime` (a `.d.ts` somewhere user bundles can import). Useful for typed user code; defer until first user-bundle integration (Wave 3+).

# ADR: Single Hermes context for `onlook-runtime.js` and the user bundle

**Status:** accepted (2026-04-15)
**Context for:** Wave 2 (`OnlookRuntime` JSI binding) of `plans/onlook-mobile-client-task-queue.md`
**Affected tasks:** MC1.4 (shipped), MC2.10 (collapsed by this ADR), MC2.3 (scope clarified)

## Context

`plans/onlook-mobile-client-task-queue.md` shipped MC1.4 ("iOS Hermes init that reads `onlook-runtime.js` and evals once") via a pure-Swift `bundleURL()` override that composes a single combined bundle (`onlook-runtime.js` + `\n` + `main.jsbundle`) and returns its `NSTemporaryDirectory()` URL. Under bridgeless / new arch, `RCTHost` evaluates the entire combined string into the **same** `jsi::Runtime` that user code subsequently runs in. The runtime's globals (e.g. `globalThis.fab`, `globalThis.RN$registerCallableModule`, the Metro `__d`/`__r` module registry, `globalThis._tryConnectWebSocket`) end up on the same global object the user bundle reads from.

The original Wave 2 plan (MC2.10) describes itself as:

> Runtime asset loader (reads baked `onlook-runtime.js` and evals into **fresh Hermes context** before user bundle)

Read literally, "fresh Hermes context" implies a **second** `jsi::Runtime` instance, separate from the one RN's `RCTHost` owns. That would force a more elaborate architecture: a host-managed runtime where the onlook runtime lives, plus inter-runtime marshaling for any value passed to or returned from the user bundle.

The source plan (`plans/onlook-mobile-client-plan.md`) only commits to one statement on this topic: "the 241KB runtime is evaluated **exactly once per Hermes context**." Singular Hermes context. The "fresh" language in MC2.10 was sketched before the bridgeless prebuild revealed the actual host topology.

## Decision

**One Hermes context shared between the onlook runtime and the user bundle.** MC1.4's prepend-and-eval-as-one-bundle approach is the canonical implementation. MC2.10 collapses to "covered by MC1.4 — closed."

## Consequences

### What this means for Wave 2

- **MC2.10 is closed.** No separate `RuntimeAssetLoader.cpp` is authored. The runtime asset loading happens in Swift's `AppDelegate.bundleURL()` (`HermesBootstrap.prepend(into:)`).
- **MC2.3 is still needed.** The runtime JS (`packages/mobile-preview/runtime/{shell,runtime,fabric-host-config,entry}.js`) does not currently install `global.OnlookRuntime`. Verified: grepping for `OnlookRuntime|onlookMount|onlookRuntime` across `packages/mobile-preview/runtime/` returns zero hits. Until that changes, native code (`OnlookRuntimeInstaller.mm`) must `runtime.global().setProperty("OnlookRuntime", hostObject)` after the JS runtime evaluates. MC2.3's installer remains the entry point for the JSI host object.
- **MC2.7 (`runApplication`) operates on the shared runtime.** When user code calls `OnlookRuntime.runApplication(bundleSource, props)`, the implementation evaluates `bundleSource` into the same `jsi::Runtime` and then calls a JS-side `onlookMount(props)` function the runtime is expected to expose. Hot reloads (`reloadBundle`, MC2.8) become "tear down the React tree and re-eval the new bundle source," not "destroy a runtime and create a new one." Atomic isolation is at the React tree level, not the JSI runtime level.
- **MC2.14 (error surface) sees JS exceptions on the same runtime.** No cross-runtime exception marshaling needed.

### What this gives up

- **No isolation between the runtime's globals and user code.** A user bundle could in principle stomp `globalThis.fab` or `globalThis.__d`/`__r`. Mitigation: lock those properties via `Object.defineProperty(globalThis, '...', { writable: false, configurable: false })` in `shell.js`. Tracked as a follow-up cleanup.
- **No support for hosting a second runtime.** If a future feature wanted to sandbox an untrusted user bundle in a separate JS world, this ADR would have to be revisited. We don't have that requirement today (the relay is trusted; user code runs in the developer's editor session).

### What this gains

- **No host-thread bridge for inter-runtime calls.** Single `jsCallInvoker`, single thread of JS execution, no `setImmediate`-style hops between contexts.
- **The runtime's `globalThis.fab = globalThis.nativeFabricUIManager` line in `shell.js:108` Just Works** — `nativeFabricUIManager` is installed by RN on the runtime that owns the surface, which is the same runtime our prepend evals into.
- **`HermesBootstrap.prepend(into:)` is platform-portable.** When MCF8c lands the Android prebuild, the same byte-level prepend can happen in `MainApplication.kt`'s bundle resolution path (Android bridgeless follows the same single-runtime model).

## Pointers

- MC1.4 implementation: commit `611752cf`, `apps/mobile-client/ios/OnlookMobileClient/{HermesBootstrap.swift,AppDelegate.swift}`, validation script `apps/mobile-client/scripts/validate-mc14.sh`.
- The runtime sources that define what's set on `globalThis`: `packages/mobile-preview/runtime/{shell,runtime,fabric-host-config,entry}.js`. Note the `[SPIKE_B]` log prefix in `shell.js:100` — the runtime is currently a Spike B artifact and may need an `OnlookRuntime`-aware refresh as Wave 2 lands; see follow-up below.
- Bridgeless RCTHost behavior verified empirically by adding `NSLog`s to `loadSourceForBridge:` and `loadBundleAtURL:` overrides; only `bundleURL()` fired. Hooks not consulted for bundle loading under new arch.

## Follow-ups

- **Adapt `runtime/shell.js` for Wave 2.** The current shell self-identifies as `[SPIKE_B]` (line 100) and pre-registers Fabric event handlers Spike B needed. Wave 2's `OnlookRuntime` API surface should be installed from the JS side too (defensive against the `OnlookRuntimeInstaller.mm` failing) — track as a separate task once MC2.3 is in.
- **Lock runtime globals against accidental user-bundle stomping.** Single-line `Object.defineProperty` pass at the end of `shell.js` for the dozen or so globals the runtime sets up. Defer until a real failure mode shows up.

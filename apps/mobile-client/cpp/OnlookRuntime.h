// Copyright Onlook 2026
//
// OnlookRuntime — JSI host object that exposes the runtime API to user JS code
// running inside the Onlook Mobile Client. Installed on `globalThis.OnlookRuntime`
// by the platform-specific installer (iOS: OnlookRuntimeInstaller.mm, MC2.3;
// Android: onlook_runtime_installer.cpp, MC2.4).
//
// Wave 2 task MC2.1 + MC2.2 of plans/onlook-mobile-client-task-queue.md.
// Method bodies for `runApplication`, `reloadBundle`, `dispatchEvent`,
// `version`, and the error-surface plumbing land in MC2.7 / MC2.8 / MC2.9 /
// MC2.12 / MC2.14 respectively. The skeleton in OnlookRuntime.cpp throws
// `jsi::JSError("not implemented")` for everything until those tasks land.
//
// ──────────────────────────────────────────────────────────────────────────
// Public API surface (consumed by the relay client + user bundles)
//
//   OnlookRuntime.runApplication(bundleSource: string, props?: object): void
//     Evaluates `bundleSource` into the same Hermes runtime this host object
//     lives in (per ADR plans/adr/MC1.4-MC2.10-runtime-context.md — single
//     Hermes context model) and then calls a JS-side `onlookMount(props)`
//     function the runtime is expected to expose. Throws a JSError if the
//     bundle source fails to evaluate or `onlookMount` is undefined.
//
//   OnlookRuntime.reloadBundle(bundleSource: string): void
//     Atomic teardown of the currently-mounted React tree, followed by a
//     fresh `runApplication(bundleSource)` with the previously-passed props.
//     Used by the relay's hot-reload path. Implementation intentionally
//     short-circuits if `bundleSource` is byte-equal to the currently
//     mounted source (idempotent under double-fire from the WS).
//
//   OnlookRuntime.dispatchEvent(name: string, payload?: any): void
//     Posts an event to JS-side listeners registered via the runtime's
//     event bus (set up in shell.js). Used for wiring native-originated
//     events (tap forwards, dev menu commands, etc.) into JS handlers
//     without going through the bridge. Payload is JSON-serialized at the
//     boundary so listeners receive a plain JS object.
//
//   OnlookRuntime.version: string (read-only property)
//     Returns the compile-time-baked binary version (sourced from
//     `@onlook/mobile-client-protocol`'s ONLOOK_RUNTIME_VERSION constant
//     via a static const string in OnlookRuntime_version.cpp / MC2.12).
//     The relay's manifest-builder uses this to refuse mismatched
//     bundles (cf-expo-relay/src/manifest-builder.ts will compare its
//     manifest's `extra.expoClient.onlookRuntimeVersion` against the
//     client's reported version when MC6.2 lands).
//
// ──────────────────────────────────────────────────────────────────────────
// Lifetime & threading
//
// One OnlookRuntime instance per Hermes runtime — installed by the
// platform installer and held by the host's runtime via the JSI HostObject
// retain mechanism. All methods run on the JS thread; the installer is
// responsible for ensuring its `setProperty` call is ordered after the JS
// runtime initializes and before any user bundle evaluates. Native event
// sources that want to call into `dispatchEvent` from a non-JS thread must
// hop via `RCTBridge.runOnJSThread` (iOS) / the equivalent CallInvoker
// (Android) — the runtime does not internally synchronize.

#pragma once

#include <jsi/jsi.h>

#include <memory>
#include <string>

namespace onlook {

/// Returns the build-time-baked `ONLOOK_RUNTIME_VERSION` string sourced from
/// `@onlook/mobile-client-protocol` via the generated
/// `OnlookRuntime_version.generated.h` header (written by
/// apps/mobile-client/scripts/generate-version-header.ts before xcodebuild).
/// Defined in OnlookRuntime_version.cpp so the version bump doesn't
/// invalidate OnlookRuntime.cpp's object file. Wave 2 task MC2.12.
std::string getRuntimeVersion();

/// `runApplication(bundleSource, props)` implementation, isolated into
/// OnlookRuntime_runApplication.cpp so Wave 2 MC2.7 changes don't invalidate
/// OnlookRuntime.cpp's object file. Mirrors the MC4.2 captureTap template —
/// OnlookRuntime::runApplication is a 1-line delegate that forwards here.
facebook::jsi::Value runApplicationImpl(
    facebook::jsi::Runtime& rt,
    const facebook::jsi::Value* args,
    size_t count);

/// `reloadBundle(bundleSource)` implementation, isolated into
/// OnlookRuntime_reloadBundle.cpp for the same TU-isolation rationale as
/// `runApplicationImpl`. Calls `globalThis.onlookUnmount()` if present to
/// tear down the current React tree, then forwards to `runApplicationImpl`
/// to re-eval + re-mount. Wave 2 task MC2.8.
facebook::jsi::Value reloadBundleImpl(
    facebook::jsi::Runtime& rt,
    const facebook::jsi::Value* args,
    size_t count);

/// `dispatchEvent(name, payload)` implementation, isolated into
/// OnlookRuntime_dispatchEvent.cpp for the same TU-isolation rationale as
/// `runApplicationImpl`. Resolves `globalThis.__onlookEventBus.dispatch`
/// and forwards `(name, payload)`; silent no-op (with a nativeLoggingHook
/// breadcrumb) if the bus has not been installed yet by the runtime
/// shell. Wave 2 task MC2.9.
facebook::jsi::Value dispatchEventImpl(
    facebook::jsi::Runtime& rt,
    const facebook::jsi::Value* args,
    size_t count);

/// Pre-warm Fabric's `findNodeAtPoint` by calling it once with off-screen
/// coordinates (-1, -1). Absorbs the ~150ms cold-start latency during
/// mount (while the splash is still up) so the first real user tap
/// returns in <30ms instead of paying the warm-up cost. Best-effort: if
/// `nativeFabricUIManager` or `findNodeAtPoint` are missing the call
/// silently no-ops. Defined in InspectorPrewarm.cpp; invoked by
/// OnlookRuntimeInstaller::install() right after `globalThis.OnlookRuntime`
/// is wired up. Wave 2 task MC2.15.
void prewarmInspector(facebook::jsi::Runtime& rt);

/// JSI host object exposing the OnlookRuntime API to JS. See file header
/// for the public-API contract. Sits behind `globalThis.OnlookRuntime`
/// once the platform installer has registered it.
class OnlookRuntime : public facebook::jsi::HostObject {
 public:
  OnlookRuntime();
  ~OnlookRuntime() override = default;

  // ── facebook::jsi::HostObject protocol ──────────────────────────────────

  /// Returns the JS-visible property for `name`. Method properties
  /// (`runApplication`, `reloadBundle`, `dispatchEvent`) return a
  /// `jsi::Function` host function bound to the corresponding C++ method.
  /// The `version` property returns a `jsi::String`. Unknown property names
  /// return `jsi::Value::undefined()`.
  facebook::jsi::Value get(
      facebook::jsi::Runtime& rt,
      const facebook::jsi::PropNameID& name) override;

  /// Throws `jsi::JSError` — the OnlookRuntime API surface is read-only
  /// from JS. This intentionally guards against user code doing
  /// `OnlookRuntime.runApplication = function () { ... }` and silently
  /// breaking the relay protocol.
  void set(
      facebook::jsi::Runtime& rt,
      const facebook::jsi::PropNameID& name,
      const facebook::jsi::Value& value) override;

  /// Lists the publicly-readable property names so `Object.keys(OnlookRuntime)`
  /// returns the documented surface and JS reflection works as expected.
  std::vector<facebook::jsi::PropNameID> getPropertyNames(
      facebook::jsi::Runtime& rt) override;

 private:
  // ── per-method implementations (delegated to from `get`'s host-function
  //    closures) — bodies land in MC2.7 / MC2.8 / MC2.9 / MC2.12 / MC2.14 ──

  facebook::jsi::Value runApplication(
      facebook::jsi::Runtime& rt,
      const facebook::jsi::Value* args,
      size_t count);

  facebook::jsi::Value reloadBundle(
      facebook::jsi::Runtime& rt,
      const facebook::jsi::Value* args,
      size_t count);

  facebook::jsi::Value dispatchEvent(
      facebook::jsi::Runtime& rt,
      const facebook::jsi::Value* args,
      size_t count);

  facebook::jsi::String version(facebook::jsi::Runtime& rt);

  // ── instance state — populated by MC2.7+ as runApplication / reloadBundle
  //    track which bundle is currently mounted ─────────────────────────────

  /// SHA-256 of the currently-mounted bundle source, or empty if no bundle
  /// is mounted. Used by `reloadBundle` for the byte-equal short-circuit.
  std::string mountedBundleSha_;

  /// JS-side `onlookMount` callable, cached on first `runApplication` so
  /// the lookup doesn't repeat on every reload. Populated by MC2.7.
  std::unique_ptr<facebook::jsi::Function> onlookMountCallable_;
};

}  // namespace onlook

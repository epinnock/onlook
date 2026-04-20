// Copyright Onlook 2026
//
// OnlookInspectorInstaller — pure-C++ TurboModule that installs the
// OnlookInspector host object on `globalThis` inside the Hermes runtime.
//
// Wave 4 task MC4.1 of plans/onlook-mobile-client-task-queue.md. Follows
// the same pattern as `OnlookRuntimeInstaller` (MC2.3) — TurboModule is
// the supported RN-0.81 bridgeless-mode mechanism for JSI host
// installation. A thin Obj-C++ wrapper in
// `OnlookInspectorInstaller.mm` conforms to the `RCTTurboModule`
// protocol and returns an instance of this class from `getTurboModule:`.
//
// The module exposes a single synchronous method — `install()` — that:
//   1. Creates a new `onlook::OnlookInspector` host object
//      (apps/mobile-client/cpp/OnlookInspector.{h,cpp}, MC4.1).
//   2. Wraps it in a `jsi::Object::createFromHostObject` so Hermes owns
//      its lifetime via its HostObject retain mechanism.
//   3. Sets it on `runtime.global()` as property `OnlookInspector`.
//   4. Emits `[onlook-inspector] OnlookInspector installed on globalThis`
//      to the device log via `nativeLoggingHook` so the MC4.1 validate
//      script can log-scrape for the confirmation.
//
// Expected caller sequence (see packages/mobile-preview/runtime/shell.js):
//   var installer = globalThis.__turboModuleProxy('OnlookInspectorInstaller');
//   installer.install();
//
// This runs alongside the existing `OnlookRuntimeInstaller.install()` call
// as part of the shell's top-of-file bootstrap, which means
// `globalThis.OnlookInspector` is available before any user-authored code
// evaluates. The Android mirror of this module will ship behind MCF8c
// with a JNI wrapper reusing the same `install(jsi::Runtime&)` logic
// (platform-neutral).

#pragma once

#include <ReactCommon/TurboModule.h>

#include <memory>
#include <string>

namespace onlook {

/// Pure-C++ TurboModule registered with RN's module registry by the
/// Obj-C++ wrapper in OnlookInspectorInstaller.mm. The single exposed JS
/// method is `install()`, which installs `onlook::OnlookInspector` on the
/// JS global and logs a confirmation line.
class OnlookInspectorInstaller : public facebook::react::TurboModule {
 public:
  explicit OnlookInspectorInstaller(
      std::shared_ptr<facebook::react::CallInvoker> jsInvoker);

  ~OnlookInspectorInstaller() override = default;

  /// Host-function body invoked by the generated method-map entry for
  /// `install`. Creates the `OnlookInspector` host object and sets it on
  /// `runtime.global().OnlookInspector`. Returns `jsi::Value::undefined()`.
  /// Logs `[onlook-inspector] OnlookInspector installed on globalThis`
  /// on success. If the property already exists, re-installs
  /// (idempotent under double-fire from a remount).
  static facebook::jsi::Value installHostObject(
      facebook::jsi::Runtime& rt,
      facebook::react::TurboModule& self,
      const facebook::jsi::Value* args,
      size_t count);

  // Static module name used in codegen method-map + RCT_EXPORT_MODULE.
  static constexpr auto kModuleName = "OnlookInspectorInstaller";
};

}  // namespace onlook

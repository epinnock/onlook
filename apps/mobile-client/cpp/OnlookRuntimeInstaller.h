// Copyright Onlook 2026
//
// OnlookRuntimeInstaller — pure-C++ TurboModule that installs the
// OnlookRuntime host object on `globalThis` inside the Hermes runtime.
//
// Wave 2 task MC2.3 of plans/onlook-mobile-client-task-queue.md. The
// TurboModule pattern is the supported RN-0.81 bridgeless-mode mechanism
// for JSI host installation (same path used by react-native-mmkv,
// react-native-reanimated, etc.). A thin Obj-C++ wrapper in
// `OnlookRuntimeInstaller.mm` conforms to the `RCTTurboModule` protocol
// and returns an instance of this class from `getTurboModule:`.
//
// The module exposes a single synchronous method — `install()` — that:
//   1. Creates a new `onlook::OnlookRuntime` host object
//      (apps/mobile-client/cpp/OnlookRuntime.{h,cpp}, MC2.1 + MC2.2).
//   2. Wraps it in a `jsi::Object::createFromHostObject` so Hermes owns
//      its lifetime via its HostObject retain mechanism.
//   3. Sets it on `runtime.global()` as property `OnlookRuntime`.
//   4. Emits `[onlook-runtime] OnlookRuntime installed on globalThis`
//      to the device log via `nativeLoggingHook` so the MC2.3 validate
//      script can log-scrape for the confirmation.
//
// Expected caller sequence (see packages/mobile-preview/runtime/shell.js):
//   var installer = globalThis.__turboModuleProxy('OnlookRuntimeInstaller');
//   installer.install();
//
// This runs as the first JS line after MC1.4's prepend, which means
// `globalThis.OnlookRuntime` is available before any user-authored code
// evaluates. MC2.4 will ship the Android mirror of this module with a
// JNI wrapper in `android/app/src/main/cpp/onlook_runtime_installer.cpp`
// reusing the same `install(jsi::Runtime&)` logic (platform-neutral).

#pragma once

#include <ReactCommon/TurboModule.h>

#include <memory>
#include <string>

namespace onlook {

/// Pure-C++ TurboModule registered with RN's module registry by the
/// Obj-C++ wrapper in OnlookRuntimeInstaller.mm. The single exposed JS
/// method is `install()`, which installs `onlook::OnlookRuntime` on the
/// JS global and logs a confirmation line.
class OnlookRuntimeInstaller : public facebook::react::TurboModule {
 public:
  explicit OnlookRuntimeInstaller(
      std::shared_ptr<facebook::react::CallInvoker> jsInvoker);

  ~OnlookRuntimeInstaller() override = default;

  /// Host-function body invoked by the generated method-map entry for
  /// `install`. Creates the `OnlookRuntime` host object and sets it on
  /// `runtime.global().OnlookRuntime`. Returns `jsi::Value::undefined()`.
  /// Logs `[onlook-runtime] OnlookRuntime installed on globalThis` on
  /// success. If the property already exists, re-installs (idempotent
  /// under double-fire from a remount).
  static facebook::jsi::Value installHostObject(
      facebook::jsi::Runtime& rt,
      facebook::react::TurboModule& self,
      const facebook::jsi::Value* args,
      size_t count);

  // Static module name used in codegen method-map + RCT_EXPORT_MODULE.
  static constexpr auto kModuleName = "OnlookRuntimeInstaller";
};

}  // namespace onlook

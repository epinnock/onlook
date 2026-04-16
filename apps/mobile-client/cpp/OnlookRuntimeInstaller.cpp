// Copyright Onlook 2026
//
// OnlookRuntimeInstaller — install() impl. See header for contract.
//
// Wave 2 task MC2.3 of plans/onlook-mobile-client-task-queue.md.

#include "OnlookRuntimeInstaller.h"

#include "OnlookRuntime.h"

#include <jsi/jsi.h>

#include <memory>
#include <string>

// `nativeLoggingHook(message, logLevel)` is a Hermes-provided global that
// writes to the platform's os_log (iOS) / __android_log_print (Android)
// stream. We emit through it rather than linking the Obj-C OnlookLogger
// symbol because this TU compiles on both iOS and Android (MC2.4); using
// the JS-runtime hook keeps the log surface platform-neutral while still
// showing up in `xcrun simctl spawn booted log stream`.
namespace {

constexpr const char* kInstalledLogLine =
    "[onlook-runtime] OnlookRuntime installed on globalThis";

void logThroughHermes(facebook::jsi::Runtime& rt, const std::string& line) {
  auto hook = rt.global().getProperty(rt, "nativeLoggingHook");
  if (!hook.isObject()) {
    return;
  }
  auto hookObj = hook.asObject(rt);
  if (!hookObj.isFunction(rt)) {
    return;
  }
  // logLevel=1 → info (matches what shell.js uses elsewhere). Pass the
  // args through `call`'s variadic form; the `Value[] / size_t` overload
  // expects an array of `Value` pointers, not an array of values.
  hookObj.asFunction(rt).call(
      rt,
      facebook::jsi::String::createFromUtf8(rt, line),
      facebook::jsi::Value(1));
}

}  // namespace

namespace onlook {

namespace jsi = facebook::jsi;
namespace react = facebook::react;

OnlookRuntimeInstaller::OnlookRuntimeInstaller(
    std::shared_ptr<react::CallInvoker> jsInvoker)
    : react::TurboModule(kModuleName, std::move(jsInvoker)) {
  // Register the `install` JS-visible method. React Native's TurboModule
  // base class handles the property lookup and caching; we just populate
  // `methodMap_` so JS `installer.install()` dispatches here.
  methodMap_["install"] = MethodMetadata{0, installHostObject};
}

jsi::Value OnlookRuntimeInstaller::installHostObject(
    jsi::Runtime& rt,
    react::TurboModule& /*self*/,
    const jsi::Value* /*args*/,
    size_t /*count*/) {
  auto hostObject = std::make_shared<OnlookRuntime>();
  auto jsObject = jsi::Object::createFromHostObject(rt, std::move(hostObject));
  rt.global().setProperty(rt, "OnlookRuntime", std::move(jsObject));
  logThroughHermes(rt, kInstalledLogLine);
  return jsi::Value::undefined();
}

}  // namespace onlook

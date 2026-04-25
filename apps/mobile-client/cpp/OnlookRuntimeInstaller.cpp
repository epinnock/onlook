// Copyright Onlook 2026
//
// OnlookRuntimeInstaller — install() impl. See header for contract.
//
// Wave 2 task MC2.3 of plans/onlook-mobile-client-task-queue.md.

#include "OnlookRuntimeInstaller.h"

#include "OnlookRuntime.h"

#include <jsi/jsi.h>

#include <cstdio>
#include <memory>
#include <string>

#if __APPLE__
#include <os/log.h>
#elif __ANDROID__
#include <android/log.h>
#endif

// `nativeLoggingHook(message, logLevel)` is a Hermes-provided global in
// standard React Native — but it's installed by RN's bridge setup
// (HermesExecutorFactory), NOT by Hermes itself. Under newArchEnabled +
// bridgeless mode, especially when a custom TurboModule runs before the
// bridge has finished wiring console routing, the hook is frequently
// ABSENT (verified on iOS 18.6 sim 2026-04-21 — see task #71 RCA in
// plans/onlook-mobile-client-task-queue.md). With the hook absent, every
// JS-side `console.log` / `slog()` call silently drops, which made the
// fetchManifest hang (#67) impossible to diagnose.
//
// The installer below back-fills `globalThis.nativeLoggingHook` with a
// platform-logging JSI function if (and only if) it's not already there.
// Runs first in `installHostObject`, before any downstream code tries to
// log. Idempotent under bridge-driven re-install: if RN later overwrites
// our hook with its own, that's fine — both wrote to os_log anyway.
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

// Writes a JS-originated log line to the platform syslog. Mirrors what
// RN's standard nativeLoggingHook does so `xcrun simctl log stream` and
// `adb logcat` both see the message. On non-iOS/non-Android platforms
// (desktop unit-test hosts) falls through to stderr so tests still print.
void platformLog(const char* msg, int /*logLevel*/) {
#if __APPLE__
  // %{public}s — mark the format specifier as non-PII so the message
  // string is actually emitted into the unified log (iOS redacts %s
  // unless public is specified). OS_LOG_DEFAULT is the app's default
  // subsystem; the prefix "[onlook-js]" makes filter regexes easy.
  os_log(OS_LOG_DEFAULT, "[onlook-js] %{public}s", msg);
#elif __ANDROID__
  __android_log_print(ANDROID_LOG_INFO, "onlook-js", "%s", msg);
#else
  std::fprintf(stderr, "[onlook-js] %s\n", msg);
#endif
}

// Install BOTH `globalThis.nativeLoggingHook` (as a fallback if RN
// hasn't yet installed its own) AND `globalThis.__onlookDirectLog`
// (our own private channel that RN's bridge won't touch).
//
// Rationale: RN's bridgeless init path appears to install its own
// nativeLoggingHook AFTER our installer runs (fire-16 diagnosis:
// installHostObject fires at t+530ms, sim-final runs confirm the
// hook is present at install time, but subsequent JS calls to
// nativeLoggingHook() from our code produce zero os_log output —
// RN must have overwritten it). `__onlookDirectLog` is a custom
// name nothing else touches, so downstream JS can rely on it
// surviving.
void installNativeLoggingHookIfAbsent(facebook::jsi::Runtime& rt) {
  namespace jsi = facebook::jsi;
  auto makeHook = [&rt](const char* propName) {
    return jsi::Function::createFromHostFunction(
        rt,
        jsi::PropNameID::forAscii(rt, propName),
        /*paramCount*/ 2,
        [](jsi::Runtime& rt,
           const jsi::Value& /*thisVal*/,
           const jsi::Value* args,
           size_t count) -> jsi::Value {
          if (count < 1 || !args[0].isString()) {
            return jsi::Value::undefined();
          }
          std::string message = args[0].asString(rt).utf8(rt);
          int logLevel = 1;
          if (count >= 2 && args[1].isNumber()) {
            logLevel = static_cast<int>(args[1].asNumber());
          }
          platformLog(message.c_str(), logLevel);
          return jsi::Value::undefined();
        });
  };

  // Private channel — always install (safe to overwrite; we own the name).
  rt.global().setProperty(
      rt, "__onlookDirectLog", makeHook("__onlookDirectLog"));

  // Standard hook — only install if RN hasn't already done so, and
  // even then RN may replace it later. JS callers should prefer
  // __onlookDirectLog for reliability.
  auto existing = rt.global().getProperty(rt, "nativeLoggingHook");
  if (existing.isObject() && existing.asObject(rt).isFunction(rt)) {
    return;
  }
  rt.global().setProperty(rt, "nativeLoggingHook", makeHook("nativeLoggingHook"));
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
  // Diagnostic breadcrumb via direct os_log — the ONLY log sink we know
  // works from cpp without the JSI hook. If this line appears in
  // `log stream`, we've confirmed installHostObject IS being called and
  // the "silence" downstream must be in logThroughHermes or after. If it
  // DOESN'T appear, the TurboModule is never instantiated by the
  // bridgeless factory (task #80 is the correct diagnosis).
#if __APPLE__
  os_log(OS_LOG_DEFAULT,
         "[onlook-runtime-direct] installHostObject entered");
#endif
  // Task #73: back-fill nativeLoggingHook before anything else so the
  // install log line below AND every downstream JS `slog()` / `console.*`
  // call actually routes to os_log / logcat. See namespace-level comment
  // for why this can't wait for RN's bridge to install the standard hook.
  installNativeLoggingHookIfAbsent(rt);
#if __APPLE__
  os_log(OS_LOG_DEFAULT,
         "[onlook-runtime-direct] nativeLoggingHook installer completed");
#endif
  auto hostObject = std::make_shared<OnlookRuntime>();
  auto jsObject = jsi::Object::createFromHostObject(rt, std::move(hostObject));
  rt.global().setProperty(rt, "OnlookRuntime", std::move(jsObject));
  // MC2.3.1: lock globalThis.OnlookRuntime against user-code replacement
  // (ADR follow-up from plans/adr/MC2.3-runtime-installer-hook.md). Calls
  // Object.defineProperty through JSI with writable:false/configurable:false
  // so `globalThis.OnlookRuntime = {}` or `delete globalThis.OnlookRuntime`
  // in a user bundle silently no-ops (strict-mode throws) instead of
  // clobbering the host object the inspector/runtime rely on. Runs after
  // setProperty above so the descriptor's `value` pulls the just-installed
  // host-object wrapper.
  {
    jsi::Object objectCtor = rt.global().getPropertyAsObject(rt, "Object");
    jsi::Function defineProperty =
        objectCtor.getPropertyAsFunction(rt, "defineProperty");
    jsi::Object descriptor(rt);
    descriptor.setProperty(
        rt, "value", rt.global().getProperty(rt, "OnlookRuntime"));
    descriptor.setProperty(rt, "writable", jsi::Value(false));
    descriptor.setProperty(rt, "configurable", jsi::Value(false));
    descriptor.setProperty(rt, "enumerable", jsi::Value(true));
    defineProperty.call(
        rt,
        rt.global(),
        jsi::String::createFromUtf8(rt, "OnlookRuntime"),
        descriptor);
  }
  logThroughHermes(rt, kInstalledLogLine);
  // MC2.15: pre-warm nativeFabricUIManager.findNodeAtPoint(-1, -1) so the
  // first real user tap doesn't pay the ~150ms cold-start. Runs AFTER the
  // install log line above so validate-mc23's log scrape sees the
  // "installed on globalThis" confirmation before any prewarm-side
  // logging. Best-effort; swallows all exceptions (see InspectorPrewarm.cpp).
  onlook::prewarmInspector(rt);
  return jsi::Value::undefined();
}

}  // namespace onlook

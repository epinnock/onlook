// Copyright Onlook 2026
//
// OnlookRuntime — skeleton implementation. See OnlookRuntime.h for the
// public-API contract and the Wave 2 task references that fill in each
// method body. Until those tasks land, every method throws
// `jsi::JSError("OnlookRuntime.<name>: not implemented (Wave 2 in progress)")`
// so a user bundle that reaches the runtime API gets a loud, attributable
// failure rather than silent undefined-behavior.
//
// Wave 2 task MC2.2 of plans/onlook-mobile-client-task-queue.md.

#include "OnlookRuntime.h"

#include <jsi/jsi.h>

#include <memory>
#include <stdexcept>
#include <string>
#include <vector>

namespace onlook {

namespace jsi = facebook::jsi;

OnlookRuntime::OnlookRuntime() = default;

// ── helper: build a host-function `jsi::Function` that delegates to a
//    member method of `this`. Used in `get()` below. Captures `this` by
//    raw pointer because the OnlookRuntime instance outlives the function
//    (the host runtime owns the OnlookRuntime via its HostObject retain). ─

namespace {

using MethodPtr = jsi::Value (OnlookRuntime::*)(
    jsi::Runtime&, const jsi::Value*, size_t);

jsi::Function makeHostMethod(
    jsi::Runtime& rt,
    const std::string& name,
    OnlookRuntime* self,
    MethodPtr method) {
  return jsi::Function::createFromHostFunction(
      rt,
      jsi::PropNameID::forUtf8(rt, name),
      0,
      [self, method](
          jsi::Runtime& runtime,
          const jsi::Value& /*thisVal*/,
          const jsi::Value* args,
          size_t count) -> jsi::Value {
        return (self->*method)(runtime, args, count);
      });
}

}  // namespace

// ── jsi::HostObject overrides ───────────────────────────────────────────

jsi::Value OnlookRuntime::get(jsi::Runtime& rt, const jsi::PropNameID& name) {
  const std::string n = name.utf8(rt);

  // ABI v1 surface (plans/adr/overlay-abi-v1.md §"Runtime globals") ──
  if (n == "abi") {
    return jsi::String::createFromAscii(rt, "v1");
  }
  if (n == "impl") {
    return jsi::String::createFromAscii(rt, "native");
  }
  if (n == "__native") {
    return jsi::Value(true);
  }
  if (n == "mountOverlay") {
    return makeHostMethod(rt, "mountOverlay", this, &OnlookRuntime::mountOverlay);
  }
  if (n == "unmount") {
    return makeHostMethod(rt, "unmount", this, &OnlookRuntime::unmount);
  }

  // Legacy / pre-ABI surface ─────────────────────────────────────────
  if (n == "runApplication") {
    return makeHostMethod(rt, "runApplication", this, &OnlookRuntime::runApplication);
  }
  if (n == "reloadBundle") {
    return makeHostMethod(rt, "reloadBundle", this, &OnlookRuntime::reloadBundle);
  }
  if (n == "dispatchEvent") {
    return makeHostMethod(rt, "dispatchEvent", this, &OnlookRuntime::dispatchEvent);
  }
  if (n == "httpGet") {
    return makeHostMethod(rt, "httpGet", this, &OnlookRuntime::httpGet);
  }
  if (n == "version") {
    return jsi::Value(rt, version(rt));
  }
  return jsi::Value::undefined();
}

void OnlookRuntime::set(
    jsi::Runtime& rt,
    const jsi::PropNameID& name,
    const jsi::Value& /*value*/) {
  const std::string n = name.utf8(rt);
  throw jsi::JSError(
      rt, "OnlookRuntime is read-only; cannot assign to property '" + n + "'");
}

std::vector<jsi::PropNameID> OnlookRuntime::getPropertyNames(jsi::Runtime& rt) {
  std::vector<jsi::PropNameID> names;
  names.reserve(10);
  // ABI v1 surface
  names.emplace_back(jsi::PropNameID::forUtf8(rt, "abi"));
  names.emplace_back(jsi::PropNameID::forUtf8(rt, "impl"));
  names.emplace_back(jsi::PropNameID::forUtf8(rt, "__native"));
  names.emplace_back(jsi::PropNameID::forUtf8(rt, "mountOverlay"));
  names.emplace_back(jsi::PropNameID::forUtf8(rt, "unmount"));
  // Legacy surface
  names.emplace_back(jsi::PropNameID::forUtf8(rt, "runApplication"));
  names.emplace_back(jsi::PropNameID::forUtf8(rt, "reloadBundle"));
  names.emplace_back(jsi::PropNameID::forUtf8(rt, "dispatchEvent"));
  names.emplace_back(jsi::PropNameID::forUtf8(rt, "httpGet"));
  names.emplace_back(jsi::PropNameID::forUtf8(rt, "version"));
  return names;
}

// ── method skeletons — bodies land in MC2.7 / MC2.8 / MC2.9 / MC2.12 ───

jsi::Value OnlookRuntime::runApplication(
    jsi::Runtime& rt,
    const jsi::Value* args,
    size_t count) {
  return runApplicationImpl(rt, args, count);
}

jsi::Value OnlookRuntime::reloadBundle(
    jsi::Runtime& rt,
    const jsi::Value* args,
    size_t count) {
  return reloadBundleImpl(rt, args, count);
}

jsi::Value OnlookRuntime::dispatchEvent(
    jsi::Runtime& rt,
    const jsi::Value* args,
    size_t count) {
  return dispatchEventImpl(rt, args, count);
}

jsi::Value OnlookRuntime::httpGet(
    jsi::Runtime& rt,
    const jsi::Value* args,
    size_t count) {
  return httpGetImpl(rt, args, count);
}

jsi::Value OnlookRuntime::mountOverlay(
    jsi::Runtime& rt,
    const jsi::Value* args,
    size_t count) {
  return mountOverlayImpl(rt, args, count);
}

jsi::Value OnlookRuntime::unmount(
    jsi::Runtime& rt,
    const jsi::Value* args,
    size_t count) {
  return unmountImpl(rt, args, count);
}

// ── ABI v1 mountOverlay / unmount inline impls ─────────────────────────
//
// `mountOverlay(source, props?, assets?)` — tear down any prior tree via
// `globalThis.onlookUnmount`, then forward (source, props) to the existing
// runApplicationImpl which handles eval + onlookMount. `assets` is accepted
// but not forwarded — the native runtime doesn't own the asset registry in
// v1 (the JS-fallback handles it; native just evals the bundle).
jsi::Value mountOverlayImpl(
    jsi::Runtime& rt,
    const jsi::Value* args,
    size_t count) {
  if (count < 1 || !args[0].isString()) {
    throw jsi::JSError(
        rt,
        "OnlookRuntime.mountOverlay: expected (source: string, props?: object, assets?: object)");
  }
  // Best-effort teardown — swallow any thrown error so a stale-tree glitch
  // doesn't block the remount (matches reloadBundle semantics).
  jsi::Value unmountVal = rt.global().getProperty(rt, "onlookUnmount");
  if (unmountVal.isObject()) {
    jsi::Object unmountObj = unmountVal.getObject(rt);
    if (unmountObj.isFunction(rt)) {
      try {
        unmountObj.getFunction(rt).call(rt);
      } catch (const jsi::JSError&) {
        // Intentionally swallowed — see reloadBundle for the rationale.
      }
    }
  }
  // Forward (source, props?) to runApplication. assets (args[2]) is ignored
  // at the native layer in v1.
  return runApplicationImpl(rt, args, count);
}

jsi::Value unmountImpl(
    jsi::Runtime& rt,
    const jsi::Value* /*args*/,
    size_t /*count*/) {
  jsi::Value unmountVal = rt.global().getProperty(rt, "onlookUnmount");
  if (!unmountVal.isObject()) {
    return jsi::Value::undefined();
  }
  jsi::Object unmountObj = unmountVal.getObject(rt);
  if (!unmountObj.isFunction(rt)) {
    return jsi::Value::undefined();
  }
  try {
    unmountObj.getFunction(rt).call(rt);
  } catch (const jsi::JSError&) {
    // Teardown failures are non-fatal — callers don't care.
  }
  return jsi::Value::undefined();
}

jsi::String OnlookRuntime::version(jsi::Runtime& rt) {
  // Sourced from `@onlook/mobile-client-protocol`'s ONLOOK_RUNTIME_VERSION
  // via apps/mobile-client/scripts/generate-version-header.ts →
  // OnlookRuntime_version.generated.h → OnlookRuntime_version.cpp. Keeping
  // the macro indirection out of this TU means a version bump only
  // recompiles OnlookRuntime_version.cpp. MC2.12.
  return jsi::String::createFromUtf8(rt, getRuntimeVersion());
}

}  // namespace onlook

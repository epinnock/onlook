// Copyright Onlook 2026
//
// OnlookInspector — skeleton implementation. See OnlookInspector.h for the
// public-API contract and the Wave 4 task references that fill in each
// method body. Until those tasks land, every method throws
// `jsi::JSError("OnlookInspector.<name>: not implemented (Wave 4 MC4.X)")`
// so a caller that reaches the inspector API gets a loud, attributable
// failure rather than silent undefined-behavior.
//
// Wave 4 task MC4.1 of plans/onlook-mobile-client-task-queue.md.

#include "OnlookInspector.h"

#include <jsi/jsi.h>

#include <memory>
#include <stdexcept>
#include <string>
#include <vector>

namespace onlook {

namespace jsi = facebook::jsi;

OnlookInspector::OnlookInspector() = default;

// ── helper: build a host-function `jsi::Function` that delegates to a
//    member method of `this`. Used in `get()` below. Captures `this` by
//    raw pointer because the OnlookInspector instance outlives the
//    function (the host runtime owns the OnlookInspector via its
//    HostObject retain). Mirrors the equivalent helper in
//    OnlookRuntime.cpp so the two TUs stay drop-in comparable. ─────────

namespace {

using MethodPtr = jsi::Value (OnlookInspector::*)(
    jsi::Runtime&, const jsi::Value*, size_t);

jsi::Function makeHostMethod(
    jsi::Runtime& rt,
    const std::string& name,
    OnlookInspector* self,
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

jsi::Value OnlookInspector::get(jsi::Runtime& rt, const jsi::PropNameID& name) {
  const std::string n = name.utf8(rt);

  if (n == "captureTap") {
    return makeHostMethod(rt, "captureTap", this, &OnlookInspector::captureTap);
  }
  if (n == "walkTree") {
    return makeHostMethod(rt, "walkTree", this, &OnlookInspector::walkTree);
  }
  if (n == "captureScreenshot") {
    return makeHostMethod(
        rt, "captureScreenshot", this, &OnlookInspector::captureScreenshot);
  }
  if (n == "highlightNode") {
    return makeHostMethod(
        rt, "highlightNode", this, &OnlookInspector::highlightNode);
  }
  return jsi::Value::undefined();
}

void OnlookInspector::set(
    jsi::Runtime& rt,
    const jsi::PropNameID& name,
    const jsi::Value& /*value*/) {
  const std::string n = name.utf8(rt);
  throw jsi::JSError(
      rt,
      "OnlookInspector is read-only; cannot assign to property '" + n + "'");
}

std::vector<jsi::PropNameID> OnlookInspector::getPropertyNames(
    jsi::Runtime& rt) {
  std::vector<jsi::PropNameID> names;
  names.reserve(4);
  names.emplace_back(jsi::PropNameID::forUtf8(rt, "captureTap"));
  names.emplace_back(jsi::PropNameID::forUtf8(rt, "walkTree"));
  names.emplace_back(jsi::PropNameID::forUtf8(rt, "captureScreenshot"));
  names.emplace_back(jsi::PropNameID::forUtf8(rt, "highlightNode"));
  return names;
}

// ── method skeletons — bodies land in MC4.2 / MC4.3 / MC4.4 / MC4.5 ─────

jsi::Value OnlookInspector::captureTap(
    jsi::Runtime& rt,
    const jsi::Value* args,
    size_t count) {
  // Arg validation: the editor-side caller (see
  // packages/browser-metro/src/host coordinate translation + the relay
  // dispatch that fans taps into the client) always sends exactly two
  // numeric screen-space coordinates. Anything else is a protocol bug we
  // want to surface loudly at the JSI boundary rather than let silently
  // coerce inside Fabric.
  if (count < 2) {
    throw jsi::JSError(
        rt,
        "OnlookInspector.captureTap: expected (x, y) — got " +
            std::to_string(count) + " argument(s)");
  }
  if (!args[0].isNumber() || !args[1].isNumber()) {
    throw jsi::JSError(
        rt,
        "OnlookInspector.captureTap: expected (x: number, y: number)");
  }

  const double x = args[0].asNumber();
  const double y = args[1].asNumber();

  // Resolve `globalThis.nativeFabricUIManager.findNodeAtPoint` and invoke
  // it. Any failure along this chain (missing Fabric UI manager, wrong
  // shape, host-side throw) is rewrapped into a JSError with a descriptive
  // prefix so callers in the editor see an attributable stack when they
  // observe it in the relay log. See OnlookInspector.h for the public
  // contract (MC4.2).
  try {
    jsi::Value fabricValue =
        rt.global().getProperty(rt, "nativeFabricUIManager");
    if (!fabricValue.isObject()) {
      throw jsi::JSError(
          rt,
          "OnlookInspector.captureTap: globalThis.nativeFabricUIManager is "
          "not available — Fabric may not be initialized yet");
    }
    jsi::Object fabric = fabricValue.asObject(rt);

    jsi::Value findNodeValue = fabric.getProperty(rt, "findNodeAtPoint");
    if (!findNodeValue.isObject() ||
        !findNodeValue.asObject(rt).isFunction(rt)) {
      throw jsi::JSError(
          rt,
          "OnlookInspector.captureTap: "
          "nativeFabricUIManager.findNodeAtPoint is not a function");
    }
    jsi::Function findNodeAtPoint =
        findNodeValue.asObject(rt).asFunction(rt);

    // Result shape is whatever Fabric's UI manager returns — typically a
    // numeric reactTag for the topmost hit, or an object containing
    // `reactTag` + a rect. We pass it through verbatim; the editor-side
    // receiver normalizes. Nothing here is allowed to allocate a string /
    // object on the error path except the JSError message itself.
    return findNodeAtPoint.call(rt, jsi::Value(x), jsi::Value(y));
  } catch (const jsi::JSError&) {
    // Already a JSError with our prefix — rethrow untouched to avoid
    // doubling the "OnlookInspector.captureTap:" prefix.
    throw;
  } catch (const std::exception& e) {
    throw jsi::JSError(
        rt,
        std::string(
            "OnlookInspector.captureTap: findNodeAtPoint threw: ") +
            e.what());
  }
}

jsi::Value OnlookInspector::walkTree(
    jsi::Runtime& rt,
    const jsi::Value* /*args*/,
    size_t /*count*/) {
  throw jsi::JSError(
      rt, "OnlookInspector.walkTree: not implemented (Wave 4 MC4.3)");
}

jsi::Value OnlookInspector::captureScreenshot(
    jsi::Runtime& rt,
    const jsi::Value* /*args*/,
    size_t /*count*/) {
  throw jsi::JSError(
      rt,
      "OnlookInspector.captureScreenshot: not implemented (Wave 4 MC4.4)");
}

jsi::Value OnlookInspector::highlightNode(
    jsi::Runtime& rt,
    const jsi::Value* args,
    size_t count) {
  // Arg validation here; UIKit body lives in OnlookInspector_highlight.mm
  // (MC4.5) behind the `highlightNodeImpl` free function declared in
  // OnlookInspector.h. Signature: (reactTag: number, color: string). Any
  // other shape is a protocol bug from the editor-side dispatcher
  // (MC4.17) and raises a JSError at the JSI boundary rather than being
  // silently coerced inside the UIKit path.
  if (count < 2) {
    throw jsi::JSError(
        rt,
        "OnlookInspector.highlightNode: expected (reactTag, color) — got " +
            std::to_string(count) + " argument(s)");
  }
  if (!args[0].isNumber()) {
    throw jsi::JSError(
        rt, "OnlookInspector.highlightNode: expected reactTag: number");
  }
  if (!args[1].isString()) {
    throw jsi::JSError(
        rt, "OnlookInspector.highlightNode: expected color: string");
  }
  const int reactTag = static_cast<int>(args[0].asNumber());
  const std::string color = args[1].asString(rt).utf8(rt);
  return highlightNodeImpl(rt, reactTag, color);
}

}  // namespace onlook

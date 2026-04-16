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
    const jsi::Value* /*args*/,
    size_t /*count*/) {
  throw jsi::JSError(
      rt, "OnlookInspector.captureTap: not implemented (Wave 4 MC4.2)");
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
    const jsi::Value* /*args*/,
    size_t /*count*/) {
  throw jsi::JSError(
      rt, "OnlookInspector.highlightNode: not implemented (Wave 4 MC4.5)");
}

}  // namespace onlook

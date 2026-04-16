// Copyright Onlook 2026
//
// OnlookRuntime::runApplication — evaluates a user JS bundle into the
// OnlookRuntime's host Hermes runtime and invokes the bundle's
// `globalThis.onlookMount(props)` entry point. Isolated into its own TU so
// the implementation can evolve (arg validation, error-surface plumbing,
// SHA-256 tracking) without invalidating OnlookRuntime.cpp's object file.
//
// Follows the MC4.2 captureTap template — one `*Impl` free function per
// method, called by a 1-line delegate in OnlookRuntime.cpp. See
// OnlookRuntime.h for the public-API contract and the Wave 2 task
// roadmap. This file corresponds to task MC2.7 of
// plans/onlook-mobile-client-task-queue.md.
//
// SHA-256 bundle-source tracking (for the reloadBundle byte-equal
// short-circuit) is deferred to MC2.8 — this TU only handles the eval +
// mount call path.

#include "OnlookRuntime.h"

#include <jsi/jsi.h>

#include <memory>
#include <string>

namespace onlook {

namespace jsi = facebook::jsi;

jsi::Value runApplicationImpl(
    jsi::Runtime& rt,
    const jsi::Value* args,
    size_t count) {
  // MC2.14 follow-up: the body is wrapped in `captureAndReport` so any throw
  // (JSError from arg-validation / eval rewrap / missing-`onlookMount`, or
  // an std::exception escaping from Hermes) is funneled through
  // `globalThis.OnlookRuntime.dispatchEvent('onlook:error', …)` with the
  // right `kind`. `captureAndReport` catches-and-swallows, so on an error
  // path the impl returns `undefined` and the JS-side observer is
  // responsible for reacting to the `onlook:error` event.
  captureAndReport(rt, [&]() {
    // Arg validation. The editor-side caller (MC3.21 qrToMount.ts) always
    // sends (bundleSource: string, props: object) once the manifest has been
    // fetched. Anything else is a protocol bug we want to surface at the JSI
    // boundary rather than let silently coerce into a string.
    if (count < 1 || !args[0].isString()) {
      throw jsi::JSError(
          rt,
          "OnlookRuntime.runApplication: expected (bundleSource: string, props?: object)");
    }

    std::string bundleSource = args[0].getString(rt).utf8(rt);
    jsi::Object props = (count >= 2 && args[1].isObject())
                            ? args[1].getObject(rt)
                            : jsi::Object(rt);

    // Evaluate the bundle into the same Hermes runtime this host object
    // lives in (single-Hermes-context model per ADR
    // plans/adr/MC1.4-MC2.10-runtime-context.md). Any eval failure is
    // rewrapped with a descriptive prefix so the relay log gets an
    // attributable stack.
    try {
      rt.evaluateJavaScript(
          std::make_shared<jsi::StringBuffer>(bundleSource),
          "onlook-user-bundle.js");
    } catch (const jsi::JSError& err) {
      throw jsi::JSError(
          rt,
          std::string("OnlookRuntime.runApplication: bundle eval failed: ") +
              err.getMessage());
    }

    // Resolve `globalThis.onlookMount` — the bundle's entry point convention.
    // Defensive guards so a bundle that forgot to call
    // `globalThis.onlookMount = ...` surfaces a clear error rather than
    // throwing "undefined is not a function" from deep inside JSI.
    jsi::Value mountVal = rt.global().getProperty(rt, "onlookMount");
    if (!mountVal.isObject() || !mountVal.getObject(rt).isFunction(rt)) {
      throw jsi::JSError(
          rt,
          "OnlookRuntime.runApplication: user bundle did not define globalThis.onlookMount");
    }
    jsi::Function mountFn = mountVal.getObject(rt).getFunction(rt);
    mountFn.call(rt, jsi::Value(rt, props));
  });

  return jsi::Value::undefined();
}

}  // namespace onlook

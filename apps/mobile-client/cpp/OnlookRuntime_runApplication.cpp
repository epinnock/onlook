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

    // Two mount conventions supported:
    //
    // 1. `globalThis.onlookMount(props)` — the native Onlook convention.
    //    Bundles emitted by MCF3's browser-metro pipeline expose this
    //    function; we call it with the props pushed from qrToMount.
    //
    // 2. cf-esm-builder's `require_runtime()` / self-mounting bundle —
    //    the bundle evaluates its own entry at top level (e.g. via
    //    `AppRegistry.registerComponent` + `AppRegistry.runApplication`).
    //    No onlookMount symbol is defined; the eval above already did
    //    all the mount work as a side effect.
    //
    // If neither convention is present, log a notice via nativeLoggingHook
    // so the scan flow can surface it without throwing — the bundle may
    // still have mounted something during eval that we can't observe.
    jsi::Value mountVal = rt.global().getProperty(rt, "onlookMount");
    if (mountVal.isObject() && mountVal.getObject(rt).isFunction(rt)) {
      jsi::Function mountFn = mountVal.getObject(rt).getFunction(rt);
      mountFn.call(rt, jsi::Value(rt, props));
    } else {
      auto hook = rt.global().getProperty(rt, "nativeLoggingHook");
      if (hook.isObject() && hook.getObject(rt).isFunction(rt)) {
        hook.getObject(rt).getFunction(rt).call(
            rt,
            jsi::String::createFromUtf8(
                rt,
                "[onlook-runtime] runApplication: globalThis.onlookMount not defined — assuming self-mounting bundle (cf-esm-builder convention)"),
            jsi::Value(1));
      }
    }
  });

  return jsi::Value::undefined();
}

}  // namespace onlook

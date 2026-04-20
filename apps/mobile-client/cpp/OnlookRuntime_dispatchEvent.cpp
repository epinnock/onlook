// Copyright Onlook 2026
//
// OnlookRuntime::dispatchEvent — posts a `{name, payload}` event to JS-side
// listeners via the runtime's event bus. The bus is a plain JS object
// installed on `globalThis.__onlookEventBus` by the runtime shell (shell.js)
// with a `.dispatch(name, payload)` method that fans out to registered
// listeners. Used for wiring native-originated events (tap forwards, dev
// menu commands, relay notifications) into JS handlers without going
// through the legacy RN bridge.
//
// Isolated into its own TU for the same reason as MC2.7's
// OnlookRuntime_runApplication.cpp and MC2.8's OnlookRuntime_reloadBundle.cpp
// — so future refinements (typed payload schema, structured error
// surfacing, listener-count instrumentation) don't invalidate
// OnlookRuntime.cpp's object file. Mirrors the MC4.2 captureTap template:
// a single `*Impl` free function called by a 1-line delegate in
// OnlookRuntime.cpp. Wave 2 task MC2.9 of
// plans/onlook-mobile-client-task-queue.md.
//
// Bus-missing fallback — if `globalThis.__onlookEventBus` has not been
// installed yet (e.g., a native event fires before the runtime shell has
// finished booting), the call is a benign no-op. We log a breadcrumb via
// `nativeLoggingHook` when available so the dropped event is attributable
// during triage; we intentionally do NOT throw, because native callers
// (tap forwarder, dev menu) have no reasonable way to recover from a
// synchronous throw across the JSI boundary. If the bus IS installed but
// `.dispatch` is not a function, that IS a protocol bug we surface as a
// JSError — the shell contract explicitly requires the dispatch method.

#include "OnlookRuntime.h"

#include <jsi/jsi.h>

namespace onlook {

namespace jsi = facebook::jsi;

jsi::Value dispatchEventImpl(
    jsi::Runtime& rt,
    const jsi::Value* args,
    size_t count) {
  // MC2.14 follow-up: wrap the body in `captureAndReport` so a throw from
  // arg-validation or from the user-registered listener (surfaced via
  // `bus.dispatch`) is funneled through the `onlook:error` event. Note the
  // specific avoidance of an infinite loop — `captureAndReport` ultimately
  // calls back into `OnlookRuntime.dispatchEvent('onlook:error', …)`, but
  // `reportRuntimeError` uses the high-level JS path (`runtime.global()`
  // → `OnlookRuntime.dispatchEvent`), which routes through this C++ impl
  // only if the JS-side doesn't throw. A pathological listener that
  // throws on `onlook:error` itself would be caught by the inner
  // try/catch in `reportRuntimeError` (which `swallow`s). The benign
  // bus-missing / nativeLoggingHook-missing no-op paths do NOT throw, so
  // the wrap is inert on the happy path.
  captureAndReport(rt, [&]() {
    // Arg validation. The editor-side + native-side callers always send
    // (name: string, payload?: any). Keep the error message format aligned
    // with MC2.7's / MC2.8's so relay-log triage can reuse the same regex.
    if (count < 1 || !args[0].isString()) {
      throw jsi::JSError(
          rt,
          "OnlookRuntime.dispatchEvent: expected (name: string, payload?: any)");
    }

    // Preserve the payload across the property-lookup sequence — building
    // `jsi::Value(rt, args[1])` up front avoids re-copying inside the
    // `callWithThis` pack argument slot below.
    jsi::Value payload =
        count >= 2 ? jsi::Value(rt, args[1]) : jsi::Value::undefined();

    // Resolve `globalThis.__onlookEventBus`. Missing bus is a benign no-op
    // (see header comment for rationale). We log via `nativeLoggingHook`
    // when available so the dropped event is attributable — the hook's
    // level-1 channel matches the convention used elsewhere in the
    // runtime shell.
    jsi::Value busVal = rt.global().getProperty(rt, "__onlookEventBus");
    if (!busVal.isObject()) {
      jsi::Value logVal = rt.global().getProperty(rt, "nativeLoggingHook");
      if (logVal.isObject() && logVal.getObject(rt).isFunction(rt)) {
        try {
          logVal.getObject(rt).getFunction(rt).call(
              rt,
              jsi::String::createFromUtf8(
                  rt,
                  "[onlook-runtime] dispatchEvent: no __onlookEventBus, event dropped"),
              jsi::Value(1));
        } catch (...) {
          // Logging is best-effort — never block the dispatch path on a
          // failed log call.
        }
      }
      return;
    }

    // Bus present — resolve `.dispatch`. A missing or non-callable dispatch
    // method IS a protocol bug we surface as a JSError, because the shell
    // contract explicitly requires the method (unlike the bus itself,
    // which may legitimately not be installed yet during early boot).
    jsi::Object bus = busVal.getObject(rt);
    jsi::Value dispatchVal = bus.getProperty(rt, "dispatch");
    if (!dispatchVal.isObject() ||
        !dispatchVal.getObject(rt).isFunction(rt)) {
      throw jsi::JSError(
          rt,
          "OnlookRuntime.dispatchEvent: __onlookEventBus.dispatch is not a function");
    }

    // `callWithThis` so `this` inside `dispatch` refers to the bus object —
    // lets the shell-side implementation store listener-registry state on
    // the bus without extra binding ceremony.
    dispatchVal.getObject(rt).getFunction(rt).callWithThis(
        rt, bus, jsi::Value(rt, args[0]), std::move(payload));
  });

  return jsi::Value::undefined();
}

}  // namespace onlook

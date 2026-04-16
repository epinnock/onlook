// Copyright Onlook 2026
//
// OnlookRuntime::reloadBundle — atomic teardown of the currently-mounted
// React tree followed by a fresh `runApplication` eval + re-mount. Used by
// the relay's hot-reload path (MC3.14 liveReload.ts → MC3.21 qrToMount.ts →
// this TU via the JSI host method).
//
// Isolated into its own TU for the same reason as MC2.7's
// OnlookRuntime_runApplication.cpp — so future refinements (byte-equal
// short-circuit via SHA-256, cached-props replay, teardown error
// aggregation) don't invalidate OnlookRuntime.cpp's object file. Mirrors
// the MC4.2 captureTap template: a single `*Impl` free function called by
// a 1-line delegate in OnlookRuntime.cpp. Wave 2 task MC2.8 of
// plans/onlook-mobile-client-task-queue.md.
//
// Teardown semantics — the JS side exposes `globalThis.onlookUnmount()`
// when the runtime bundle has set one up (for React's
// `root.unmount()` call path). If the hook is absent we skip teardown:
// the subsequent `runApplication` → `onlookMount(props)` call will
// replace the Fabric tree anyway, since Fabric's commit is root-scoped.
// A thrown teardown exception is caught and swallowed — we still want
// the remount to proceed so the user doesn't get stuck on a stale tree.

#include "OnlookRuntime.h"

#include <jsi/jsi.h>

namespace onlook {

namespace jsi = facebook::jsi;

jsi::Value reloadBundleImpl(
    jsi::Runtime& rt,
    const jsi::Value* args,
    size_t count) {
  // Arg validation. The editor-side caller (MC3.14 liveReload.ts) sends
  // only the bundle source — props are re-used from the previously-cached
  // `runApplication` call site. Keep the error message aligned with
  // MC2.7's format so relay-log triage can reuse the same regex.
  if (count < 1 || !args[0].isString()) {
    throw jsi::JSError(
        rt, "OnlookRuntime.reloadBundle: expected (bundleSource: string)");
  }

  // 1. Tear down the current React tree. Resolving `globalThis.onlookUnmount`
  //    is best-effort — a bundle that never mounted (or one that uses a
  //    different teardown convention) should not block the remount. Any
  //    JSError raised by the hook itself is caught and discarded; the
  //    subsequent `runApplicationImpl` call replaces the tree wholesale
  //    via React's root-scoped Fabric commit.
  jsi::Value unmountVal = rt.global().getProperty(rt, "onlookUnmount");
  if (unmountVal.isObject()) {
    jsi::Object unmountObj = unmountVal.getObject(rt);
    if (unmountObj.isFunction(rt)) {
      try {
        unmountObj.getFunction(rt).call(rt);
      } catch (const jsi::JSError&) {
        // Teardown failure is non-fatal — the new mount will clobber the
        // stale tree. Deferring error-surface plumbing to MC2.14.
      }
    }
  }

  // 2. Re-mount via MC2.7's runApplicationImpl. Only the bundle source is
  //    forwarded — props are left to default to an empty object inside
  //    runApplicationImpl. Cached-props replay is tracked as an MC2.8
  //    follow-up (uses `OnlookRuntime::mountedBundleSha_` + a future
  //    `mountedProps_` jsi::Object field).
  return runApplicationImpl(rt, args, count);
}

}  // namespace onlook

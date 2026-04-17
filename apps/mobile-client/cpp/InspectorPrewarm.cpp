// Copyright Onlook 2026
//
// InspectorPrewarm.cpp — Wave 2 task MC2.15 of
// plans/onlook-mobile-client-task-queue.md.
//
// Pre-warm `nativeFabricUIManager.findNodeAtPoint(-1, -1)` immediately after
// OnlookRuntime is installed on globalThis. Profiling on the Mac mini (see
// MC2.15 notes) shows the first invocation of Fabric's `findNodeAtPoint`
// carries ~150ms of cold-start latency — JIT warm-up of the JS shim, the
// first-hit ShadowNode-tree traversal path, and associated allocator pages
// all land on whichever caller runs it first. Without prewarming that cost
// lands on the user's first tap (captureTap(x, y) in OnlookInspector.cpp,
// MC4.2) and is visibly laggy.
//
// By calling it once with off-screen coordinates during mount we absorb the
// cold-start cost while the splash screen is still up, so the first real
// tap returns in <30ms. (-1, -1) is outside any renderable region and the
// Fabric implementation returns null/0 for it without side effects — it
// never highlights a node, never fires any handler, and never throws.
//
// Call site: invoked from OnlookRuntimeInstaller.cpp's install() host
// function AFTER `globalThis.OnlookRuntime = ...` is set, so the runtime
// reports itself as installed before we do the probe. Ordering matters for
// the validate-mc23 log scrape — the "installed on globalThis" line must
// land first so its tests don't race with any prewarm-side logging.
//
// Safety: the implementation is intentionally defensive. If
// `nativeFabricUIManager` is missing from globalThis, isn't an object,
// doesn't have a `findNodeAtPoint` method, or the call throws, we swallow
// it silently. Prewarm is best-effort; if it fails the first real tap just
// pays the cold-start cost once. We do NOT want prewarm failures to
// escalate into user-visible errors, because the runtime is otherwise
// perfectly functional without the optimization.

#include "OnlookRuntime.h"

#include <jsi/jsi.h>

namespace onlook {

namespace jsi = facebook::jsi;

void prewarmInspector(jsi::Runtime& rt) {
  try {
    jsi::Value fabVal = rt.global().getProperty(rt, "nativeFabricUIManager");
    if (!fabVal.isObject()) {
      return;
    }
    jsi::Object fab = fabVal.getObject(rt);
    jsi::Value findVal = fab.getProperty(rt, "findNodeAtPoint");
    if (!findVal.isObject() || !findVal.getObject(rt).isFunction(rt)) {
      return;
    }
    jsi::Function findFn = findVal.getObject(rt).getFunction(rt);
    findFn.callWithThis(rt, fab, jsi::Value(-1), jsi::Value(-1));
  } catch (...) {
    // Swallow — prewarm is best-effort. If it fails, first real tap
    // just pays the cold-start cost.
  }
}

}  // namespace onlook

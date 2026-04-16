// Copyright Onlook 2026
//
// OnlookInspector_walkTree.mm — Fabric shadow-tree walker used by the
// editor's element tree panel. Walks `globalThis.nativeFabricUIManager`
// starting from a caller-supplied `reactTag` and emits a plain JS object
// tree `{ reactTag, componentName, children[] }` that the relay can
// serialize back to the editor without needing any additional JSI hops.
//
// Wave 4 task MC4.3 of plans/onlook-mobile-client-task-queue.md. Sibling
// of OnlookInspector_highlight.mm (MC4.5) — split into its own TU so the
// shared OnlookInspector.cpp HostObject shell stays stable across wave
// tasks and so per-method bodies can land (and regress) independently.
//
// ──────────────────────────────────────────────────────────────────────
// Why a separate TU?
//
// The HostObject in OnlookInspector.cpp only does arg validation and
// delegates to per-method free functions declared in OnlookInspector.h
// (mirrors the `highlightNodeImpl` pattern). Keeping the walk body here
// means the editor-tree-panel MC tasks touch this single file without
// creating rebase pressure on the shared shell.
//
// ──────────────────────────────────────────────────────────────────────
// Implementation notes
//
// We only recurse through `getChildrenByTag(reactTag) -> number[]`, which
// Fabric exposes on `nativeFabricUIManager` once the surface is mounted.
// Any failure (manager missing, function missing, returned value of the
// wrong shape) downgrades to a stub node rather than aborting the whole
// walk — the editor tree panel tolerates partial data and surfaces the
// gap, which is strictly more useful than a hard throw. A missing Fabric
// manager at the *root* call is still a JSError because that indicates
// the client was not initialized yet and the caller should retry.

#include "OnlookInspector.h"

#include <jsi/jsi.h>

namespace onlook {

namespace jsi = facebook::jsi;

// Recursively walks globalThis.nativeFabricUIManager.getChildrenByTag(reactTag)
// and returns `{ reactTag, componentName, children[] }` for each node. The
// componentName is left as "unknown" for now — Fabric does not expose a
// stable `getViewName(tag)` across RN 0.74–0.76 and the editor panel falls
// back to matching reactTag against its own source map. A follow-up task
// (MC6.x) may thread componentName through once a portable accessor lands
// upstream.
static jsi::Object walkOne(jsi::Runtime& rt, jsi::Object& fab, int tag) {
  jsi::Object result(rt);
  result.setProperty(rt, "reactTag", jsi::Value(tag));

  jsi::Value getChildrenVal = fab.getProperty(rt, "getChildrenByTag");
  if (!getChildrenVal.isObject() ||
      !getChildrenVal.getObject(rt).isFunction(rt)) {
    // Fallback: return stub. The editor tolerates partial data; a missing
    // accessor here usually means the Fabric surface is mid-mount.
    result.setProperty(
        rt, "componentName", jsi::String::createFromUtf8(rt, "unknown"));
    result.setProperty(rt, "children", jsi::Array(rt, 0));
    return result;
  }

  jsi::Value childrenVal =
      getChildrenVal.getObject(rt).getFunction(rt).callWithThis(
          rt, fab, jsi::Value(tag));
  if (!childrenVal.isObject() || !childrenVal.getObject(rt).isArray(rt)) {
    result.setProperty(
        rt, "componentName", jsi::String::createFromUtf8(rt, "unknown"));
    result.setProperty(rt, "children", jsi::Array(rt, 0));
    return result;
  }

  jsi::Array arr = childrenVal.getObject(rt).getArray(rt);
  size_t len = arr.size(rt);
  jsi::Array children(rt, len);
  for (size_t i = 0; i < len; i++) {
    jsi::Value childTag = arr.getValueAtIndex(rt, i);
    if (childTag.isNumber()) {
      children.setValueAtIndex(
          rt,
          i,
          walkOne(rt, fab, static_cast<int>(childTag.getNumber())));
    }
  }

  result.setProperty(
      rt, "componentName", jsi::String::createFromUtf8(rt, "unknown"));
  result.setProperty(rt, "children", std::move(children));
  return result;
}

jsi::Value walkTreeImpl(jsi::Runtime& rt, const jsi::Value* args, size_t count) {
  if (count < 1 || !args[0].isNumber()) {
    throw jsi::JSError(
        rt, "OnlookInspector.walkTree: expected (reactTag: number)");
  }
  int tag = static_cast<int>(args[0].getNumber());
  jsi::Value fabVal = rt.global().getProperty(rt, "nativeFabricUIManager");
  if (!fabVal.isObject()) {
    throw jsi::JSError(
        rt,
        "OnlookInspector.walkTree: nativeFabricUIManager not installed");
  }
  jsi::Object fab = fabVal.getObject(rt);
  return walkOne(rt, fab, tag);
}

}  // namespace onlook

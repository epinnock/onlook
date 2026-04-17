# ADR: Wrap every `renderApp` call in a keyed Fragment to defeat Fabric's reactTag dedupe

**Status:** accepted (2026-04-17)
**Context for:** the Spike B (B13) Expo Go eval-push pipeline — live preview of user-edited React Native code on the iOS Simulator running Expo Go SDK 54.
**Relates to:** PR #12 (consolidated merge of `feat/mobile-preview-shim` + `feat/mobile-client`). Fix shipped in commit `8034e8e9`; regression test in `dc3e1d95`.

## Context

After the initial `AppRegistry.runApplication` commit, the runtime renders a small default screen ("Onlook Runtime Ready / Waiting for component code…"). Subsequent pushes via `POST /push` with `{type:"eval", code}` reach the sim — the JS eval runs cleanly, `globalThis.renderApp(element)` is called, the reconciler runs its host config callbacks, and all of the following logs fire:

```
[SPIKE_B] B13 eval OK
[SPIKE_B] HOST resetAfterCommit children=1
[SPIKE_B] HOST appendToSet child tag=1000004 type=View node=object
[SPIKE_B] HOST completeRoot rootTag=21 count=1
[SPIKE_B] HOST completeRoot DONE
```

Yet the sim's screen does not change — it stays on the default screen rendered by the first commit.

Diagnostic pushes established:

- `globalThis.React`, `globalThis.createElement`, `globalThis.renderApp`, `globalThis.currentRootTag` are all present and correct after the AppRegistry mount (`typeof renderApp === 'function'`, `rootTag=21`).
- `React[internals]` is resolved (the ESM-default unwrap in `runtime.js` runs).
- `nativeFabricUIManager` probe (via `Object.getOwnPropertyNames` + typed-function check) shows `createNode`, `cloneNodeWithNewProps`, `cloneNodeWithNewChildren`, `cloneNodeWithNewChildrenAndProps`, `appendChild`, `appendChildToSet`, `createChildSet`, `completeRoot`, `registerEventHandler`, `dispatchCommand`, `setNativeProps`, `sendAccessibilityEvent`. No `startSurface`/`stopSurface`/`registerMountingTransactionListener` — this is the early-Fabric API surface, not bridgeless Fabric 2.
- The reconciler is committing: `resetAfterCommit` fires with `children=1`; our `commitContainerChildren` creates a fresh `childSet`, appends the new root node to it, and calls `fab.completeRoot(rootTag, childSet)`.
- Across two consecutive pushes, `HOST appendToSet child tag=1000004 type=View` logs the **same** reactTag `1000004` on both commits.

That last observation is the smoking gun. React reuses the root host fiber when the element tree's root `<View>` is the same type across renders; `commitUpdate` then runs `instance.node = fab.cloneNodeWithNewProps(instance.node, newProps)`, which preserves the node's reactTag. When `resetAfterCommit` then hands Fabric a childSet containing a node with the same reactTag that already roots the committed surface, Expo Go SDK 54's early-Fabric UIManager treats the commit as redundant and skips the mount.

Empirically confirmed by injecting an explicit `key: Date.now()` on the root child in a Fragment wrapper: with that key, `HOST appendToSet child tag=1000007` (new tag), and the sim renders the new screen. Three consecutive keyed pushes painted three distinct screens (red → blue → orange with different text markers).

## Decision

`renderApp(element)` always wraps its input in a Fragment and injects a monotonic key `__onlook_render_<seq>` on the child. If the caller already provided a key the element passes through unchanged (so explicit keying still works).

Concretely (`packages/mobile-preview/runtime/wrap-for-keyed-render.js`):

```js
function wrapForKeyedRender(ReactApi, element, seq) {
  const keyed =
    element && typeof element === 'object' && element.key == null
      ? ReactApi.cloneElement(element, { key: '__onlook_render_' + seq })
      : element;
  return ReactApi.createElement(ReactApi.Fragment, null, keyed);
}
```

`renderApp` in `runtime.js` increments a module-local counter on every call and hands the wrapped element to `_reconciler.updateContainer`.

Rationale:

- **Correctness.** Forces a fresh host instance on every push → new reactTag → Fabric no longer dedupes. Verified end-to-end on iOS Simulator (screenshots saved under `/tmp/sim-edit-{1,2,3}.png` and `/tmp/sim-autokeyed.png`).
- **No caller impact.** User code can still use explicit keys; the shape is a transparent wrap.
- **Minimal surface area.** The logic lives in a dedicated file so the exported helper can be unit-tested without importing runtime.js (which eagerly builds a reconciler and calls `globalThis._log`). Regression test in `packages/mobile-preview/runtime/__tests__/wrap-for-keyed-render.test.ts` asserts: Fragment wrapping, monotonic key uniqueness, caller-key passthrough, non-object passthrough.
- **Bundled runtime unchanged semantically.** The fix is a one-line addition inside `renderApp`; the rest of the reconciler/host-config pipeline is untouched, so the existing 92 runtime unit tests continue to pass (96 total after the 4 new ones).

## Alternatives considered

1. **Switch to `React.flushSync` around `updateContainer`.** Would flush the scheduler synchronously, but the issue isn't scheduling — `HOST completeRoot DONE` already fires synchronously. The commit lands in Fabric; Fabric ignores it.
2. **Swap root children via direct `fab.appendChildToSet` / `fab.completeRoot` calls outside the reconciler.** Works, but bypasses React's commit pipeline and loses update diffing, event handlers, etc. Incompatible with the wrap-eval-bundle's hook-using user code path.
3. **Upgrade to bridgeless-Fabric `startSurface`/`stopSurface` API.** Not exposed on Expo Go SDK 54's UIManager (probe returned `FAB_PROBE_MISSING: startSurface, stopSurface, setSurfaceProps, registerMountingTransactionListener`). Would require a custom Expo Go build — out of scope for a merge-consolidation PR.

## Consequences

- Every push triggers a full remount of the user's app tree. For small preview workloads this is fine (sub-frame on modern devices) and matches what a save-triggered reload would do on a paper renderer. It does, however, mean hook state resets across pushes — which is the expected live-preview semantic here.
- If a future Expo SDK ships with bridgeless Fabric and surface-aware mount APIs, this wrap becomes unnecessary and should be revisited (delete the wrap + the test; update this ADR).
- The wrap adds a single Fragment to the element tree. Fragment children are not host instances, so Fabric never sees it — no measurable perf cost.

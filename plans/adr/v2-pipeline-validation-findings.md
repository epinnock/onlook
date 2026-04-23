# ADR: Two-Tier v2 Pipeline — Simulator Validation Findings (2026-04-22)

**Status:** Accepted (findings doc)
**Date:** 2026-04-22
**Decider(s):** Claude session 873a2632 (worktree `.trees/two-tier-bundle`, mini `devicefarmers-mac-mini.local`)
**Related task(s):** #68 (recapture v2 screenshots), #66, #69, #74, #75 on the session task list

## Context

Objective: obtain photographic evidence of the full two-tier overlay pipeline on a real iOS simulator — mount a bundle served by the relay, then prove an in-place update. Validation target: iPhone 16 sim on iOS 18.6, bridgeless + new-arch (`newArchEnabled: true`), RN 0.81.6, Xcode 16.4 (mini).

Along the way the session uncovered seven distinct integration-layer bugs that had been masked by earlier smoke tests. This ADR records them so the next agent does not re-walk the chain.

## Decision

Capture each finding + chosen mitigation + what it reveals about the architecture. The cumulative mitigation set lets the pipeline reach "bundle mounted + renderApp called" end-to-end, with `OverlayHost` in `App.tsx` as the single React render surface (no second `AppRegistry.runApplication`).

## Findings chain

### 1. Deep-link query param mismatch
`apps/mobile-client/src/deepLink/parse.ts:117` reads `session`, not `sessionId`. Any test URL using `?sessionId=...` silently fails at the parse stage with `ok:false, stage:'parse'`, and the mock-relay never sees a fetch. Fix: use `session=` (or the `exp://.../manifest/<hash>` form which extracts the hash as sessionId).

### 2. `fetch()` broken on bridgeless iOS 18.6
`buildUrlPipelineRunner`'s preflight to `https://1.1.1.1/` times out after 8s even with full internet. Same class as fire-16 — `RCTNetworking` accepts but never dispatches response events back to JS in bridgeless iOS 18.6. The preflights are diagnostic-only; skipping them unblocks the pipeline. Real fetches to the relay worked (Metro/react-native's request path, not `fetch()`). `OnlookRuntime.httpGet` (synchronous JSI→NSURLSession) is the documented workaround for the general case.

### 3. `runtime.js` clobbers mobile-client's `renderApp`
`packages/mobile-preview/runtime/entry.js` gated `require('./runtime.js')` on `typeof window !== 'undefined'`. The comment assumed runtime loaded BEFORE `main.jsbundle`; in fact the onlook-combined build concatenates `main.jsbundle + onlook-runtime.js`, so RN's `InitializeCore` has already set `globalThis.window = globalThis` by the time the gate runs. Result: runtime.js loads on the mobile client, redefines `globalThis.renderApp` with its reconciler-based version, overwriting the mobile-client's simpler bridge. Fix: (a) replaced gate with `!globalThis.__noOnlookRuntime` and (b) mobile-client's `index.js` sets that flag at the top. Pin the mobile-client's `renderApp` with `Object.defineProperty writable:false` as a second line of defense.

### 4. `RCTRawText` / `RCTText` strings require Fabric host-config
Shell.js's default "Onlook Runtime Ready" tree uses raw component names (`RCTRawText`, `RCTText`). Those only work when runtime.js's Fabric host-config is loaded. With `__noOnlookRuntime=true`, the tree throws `Invariant Violation: View config getter callback for component 'RCTRawText' must be a function (received undefined)`. Fix: `containsBadComponent` filter in mobile-client's renderApp drops any tree containing those names before propagating to `OverlayHost`, and `OverlayHost` wraps its child in an `OverlayErrorBoundary`. Real overlay bundles should use `RN.View`/`RN.Text` from `globalThis.ReactNative` (which `index.js` now exposes).

### 5. `runtime.js`'s `createView` absent in new-arch
Even when successfully loaded in the old-arch path, runtime.js's reconciler calls `UIManager.createView` / `setChildren` / `updateView`. In bridgeless + new-arch these are no-ops that log `[ReactNative Architecture][JS] 'createView' is not available in the new React Native architecture.` and render a RedBox. This makes runtime.js unusable on the mobile client by design, not just inconvenient; see finding #3 for the gate.

### 6. `AppRegistry.runApplication` silent on mounted rootTag
`AppRegistry.runApplication('OnlookOverlay', {rootTag: 1})` does NOT re-mount a new JS tree when rootTag 1 already hosts `'main'`. In bridgeless mode this path falls through to `UIManager.createView` (missing in new-arch), producing the RedBox from finding #5 even when no other path does. Fix: do NOT call `AppRegistry.runApplication` in `renderApp`. Render `<OverlayHost />` directly inside the existing `App.tsx` fragment; `renderApp` only mutates `_onlookOverlayElement` + notifies subscribers.

### 7. Subscriber Set must live on globalThis
The first iteration put `_onlookOverlaySubscribers` as a module-local `const` in `index.js`. `OverlayHost` (in `App.tsx`) added its `pull` function to `globalThis._onlookOverlaySubscribers` — a DIFFERENT Set. `index.js`'s `renderApp` notified the local Set, which was empty. Result: UI never re-rendered. Fix: unify on `gt._onlookOverlaySubscribers` so every subscriber (cross-module) is reachable.

### 8. Bridgeless WebSocket `onopen` doesn't dispatch to JS
The TCP connection to the relay's WS succeeds (relay log shows `[WS] connected`), but neither `shell.js`'s `websocketOpen` callable-module event nor `AppRouter`'s native `ws.onopen` ever fire in JS. Same shape as the `fetch()` bug — responses accepted at the native layer but events don't dispatch upward. Workaround for the demo: append a `setTimeout(renderApp(...))` snippet directly to the bundle body the relay serves, so the overlay re-render proves end-to-end without WS. Long-term fix: switch the in-app relay-event channel to polling via `OnlookRuntime.httpGet` (the JSI bypass is the same one already used for manifest/bundle fetches).

## Alternatives considered

- **Old-arch (disable `newArchEnabled`):** rejected. Team already committed to new-arch for perf / Fabric inspector hooks; downgrading would require parallel maintenance.
- **Build a release scheme to disable RedBox:** partial win but doesn't fix the underlying bridgeless WS/fetch bugs. Would mask them.
- **Rewrite runtime.js with a new-arch Fabric host-config:** correct long-term direction but a multi-day investment; out of scope for the validation session.
- **Skip the validation entirely and ship:** rejected — user explicitly required pixel evidence ("we fail those kids").

## Consequences

Positive:
- Next agent has a seven-item pre-flight checklist before touching the mobile client.
- `OverlayHost`-in-`App.tsx` pattern is simpler than dual roots and works today.
- The filter + error boundary in `renderApp` hard-stops future RCT*-string regressions.

Negative:
- `OverlayAck` and any other phone→editor event still needs a replacement for WS. Poll via `OnlookRuntime.httpGet` is the likely path. **Update 2026-04-22:** shipped `packages/mobile-preview/runtime/src/relayEventPoll.ts` (the JS-side primitive); editor-side + cf-expo-relay /events endpoint + mobile-client wire-up remain.
- ~~Runtime.js is now officially dead weight on the mobile client; keeping the gate means the package still ships it. Could split the runtime bundle later.~~ **Update 2026-04-22 (MCG.8):** split into `bundle-client-only.js` (8.8 KB) vs `bundle.js` (257.6 KB), a 96.6% savings. mobile-client's `bundle-runtime.ts` defaults to the slim bundle; Expo Go / mobile-preview harness keeps the full bundle.
- Dev-build RedBox still covers the overlay when something throws; release builds hide it but are not set up for the sim.

Neutral:
- The AUTO_RUN flag in `AppRouter.tsx` is enabled on mini's checkout and must be reverted before commit (tracked as task #80).

## Open questions

- Why does `ws.onopen` not dispatch in bridgeless iOS 18.6 even when the TCP connection is established? Is there an Expo/RN config that enables it, or is it a platform bug we must route around?
- The mobile-client's `OnlookRuntime.httpGet` (iOS) is documented (`OnlookRuntime.h:122`) but we have not exercised it from JS. A tiny poll-based relay-event path would let us close the update-channel gap without WS.
- `AppRegistry.runApplication` in new-arch — is there a documented replacement that actually re-mounts a new root on an existing surface?

## References

- `apps/mobile-client/src/deepLink/parse.ts:117` (finding #1)
- `apps/mobile-client/src/navigation/AppRouter.tsx` `buildUrlPipelineRunner` (finding #2)
- `packages/mobile-preview/runtime/entry.js` + `apps/mobile-client/index.js` (findings #3, #5)
- `apps/mobile-client/src/App.tsx` `OverlayHost` (findings #6, #7)
- Screenshot evidence (permanent):
  - `plans/adr/assets/v2-pipeline/v2r-hello.png` — initial mount ("Hello, Onlook!" on dark blue)
  - `plans/adr/assets/v2-pipeline/v2r-updated.png` — in-place overlay update ("UPDATED via v2!" on dark green)
  - `plans/adr/assets/v2-pipeline/post-g-launcher.png` — post-Phase-G rebuild launcher (2026-04-23, Xcode 16.4 on mini, iPhone 16 sim): confirms committed code compiles, app boots without RedBox, OverlayHost sibling doesn't break AppRouter rendering, slim `bundle-client-only.js` serves correctly from `/Resources/onlook-runtime.js`, `__noOnlookRuntime=true` + subscribable renderApp + entry.js gate all compose cleanly in main.jsbundle
- Iteration trail (ephemeral): `tmp-screenshots/validate-v2-take2/v2*.png`
- Mock relay: `mini:/tmp/mock-relay.js`
- Earlier post-mortem on dual-React: `plans/post-mortems/2026-04-16-runtime-d-r-clobber.md`

# ADR: OverlayHost — single React surface for two-tier v2 overlays

**Status:** Accepted
**Date:** 2026-04-22
**Decider(s):** Claude session 873a2632 (worktree `.trees/two-tier-bundle`)
**Related task(s):** #68, #77, #81, #85, #90, #92 from the session task list

## Context

The two-tier v2 overlay pipeline (`overlay-abi-v1.md`) needs to mount an
overlay React tree inside the running Onlook Mobile Client's JS context,
on top of whatever AppRouter screen happens to be active. Two surface
attachment strategies were on the table:

1. **Second AppRegistry.runApplication root** — `runApplication('OnlookOverlay',
   { rootTag: 1 })` pushing a fresh React tree onto the existing native
   rootTag.
2. **OverlayHost-in-App.tsx** — a sibling `<OverlayHost />` inside the
   existing root component, subscribing to `globalThis._onlookOverlayElement`
   via a `globalThis._onlookOverlaySubscribers` Set.

Simulator validation on iPhone 16 / iOS 18.6 (bridgeless + new-arch, RN
0.81.6, Xcode 16.4) eliminated option 1. See
`v2-pipeline-validation-findings.md` findings #5 + #6: `AppRegistry.runApplication`
silently no-ops when the target rootTag is already mounted, and any path
that falls through to `UIManager.createView` throws a RedBox because that
API is absent in new-arch.

## Decision

Adopt **OverlayHost-in-App.tsx**: a single `<OverlayHost />` React component
lives next to `<AppRouter />` in `apps/mobile-client/src/App.tsx`'s root
fragment and subscribes to a process-wide notification Set that
`globalThis.renderApp` pushes to.

What changes:

- `apps/mobile-client/index.js` installs `globalThis.renderApp` — a pure push
  function that sets `_onlookOverlayElement` and notifies
  `_onlookOverlaySubscribers`. Extracted for testability as
  `src/overlay/renderAppBridge.ts` (production copy stays inline in
  `index.js` because Expo's `registerRootComponent` runs before the bundler
  processes TypeScript).
- `OverlayHost` reads `_onlookOverlayElement` on mount + on every
  subscriber notification. It renders the element inside an absolutely-
  positioned `<View pointerEvents="box-none" />` so overlay elements float
  above `AppRouter` but pass taps through empty regions.
- The element is wrapped in `OverlayErrorBoundary` (also in `src/overlay/`);
  a throwing overlay drops to `null` without RedBoxing the whole app, and
  the next `renderApp` push resets the boundary via `componentDidUpdate`.
- `renderApp` is pinned via `Object.defineProperty` with
  `writable: false, configurable: false` so `packages/mobile-preview/runtime/
  runtime.js` cannot clobber it (see finding #3).
- `renderApp` filters trees containing raw native component strings
  (`RCTRawText`, `RCTText`, `RCTView`) before propagating — those identifiers
  require Fabric host-config, which the mobile-client deliberately does not
  load (`globalThis.__noOnlookRuntime = true`; finding #4).

## Alternatives considered

- **Option A (chosen): OverlayHost inside App.tsx.** Simple, works on
  bridgeless+new-arch today, requires zero native code changes.
- **Option B: `AppRegistry.runApplication('OnlookOverlay', { rootTag: 1 })`.**
  Rejected — silently no-ops against already-mounted rootTag (finding #6)
  and any fallback triggers `UIManager.createView` RedBox (finding #5).
- **Option C: dedicated native overlay surface (new UIView created by the
  installer TurboModule).** Rejected for scope — multi-day native work,
  needs Fabric renderer hookup, and OverlayHost already satisfies the
  requirement with only JS-layer changes.
- **Option D: put subscribers / element on a module-local const in
  `index.js`.** Rejected — the first iteration did this and
  `OverlayHost` (a different module) created its own `Set` on `globalThis`,
  so `index.js`'s `renderApp` notified nobody (finding #7). Unifying on
  `globalThis._onlookOverlaySubscribers` removes that failure mode.

## Consequences

Positive:

- No native changes required; ships on any Expo-managed mobile client that
  can run the RN 0.81.6 Hermes bundle.
- Unit-testable end-to-end — `renderAppBridge.ts` + `OverlayErrorBoundary`
  + `badComponentFilter` each have their own bun:test file, plus an
  integration test (`fakeRuntime.integration.test.ts`) evaluates a bundle
  body through `Function(...)` to mimic JSI mountOverlay.
- Overlay bundles can push arbitrarily frequent updates (the subscribable
  mechanism re-renders the host on each push with standard React diffing).

Negative:

- `runtime.js` still ships in the combined bundle but is dead weight on
  the mobile client (the `__noOnlookRuntime` gate stops it loading). Split
  runtime.js out of the mobile-client path is tracked as task #84.
- `OverlayHost` lives in `App.tsx` — agents editing the root fragment need
  to preserve the `<OverlayHost />` sibling, otherwise overlays silently
  stop rendering. Noted in a code comment on the component.
- RedBox still shows for genuine overlay-runtime errors in dev builds;
  release builds hide RedBox but aren't yet set up on the simulator.

Neutral:

- The subscribable pattern means overlay elements with identical React
  structure still trigger a re-render (the subscriber's `useState` gets
  called). Minor runtime cost; not a correctness issue.

## Open questions

- Should `OverlayHost` memoize the element by reference to skip redundant
  state updates when the subscriber fires twice with the same tree? Only
  matters once we have real overlay traffic volume to measure against.
- Do we want a `key`-based element ID pushed through `renderApp(el, key)`
  so the boundary's reset-on-new-children logic has a reliable signal
  instead of relying on React element identity? Defer until real overlay
  pushes show flake.
- Should overlay elements be able to opt into fullscreen modal behavior
  (occluding taps) versus floating box-none? Add via props once a real
  overlay demands it.

## References

- `apps/mobile-client/src/App.tsx` — `OverlayHost`
- `apps/mobile-client/index.js` — subscribable renderApp install
- `apps/mobile-client/src/overlay/renderAppBridge.ts` — extracted testable
  install function
- `apps/mobile-client/src/overlay/OverlayErrorBoundary.tsx` — error
  boundary wrapping the overlay child
- `apps/mobile-client/src/overlay/badComponentFilter.ts` — RCT* tree
  dropper
- `plans/adr/v2-pipeline-validation-findings.md` findings #3–#7 — the
  validation trail that produced this design
- `plans/adr/overlay-abi-v1.md` — the overlay ABI this host surface is
  built against
- Screenshot evidence: `plans/adr/assets/v2-pipeline/v2r-{hello,updated}.png`

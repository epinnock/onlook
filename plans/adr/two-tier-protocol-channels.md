# ADR: Two-tier overlay protocol — channel coexistence

**Status:** Accepted
**Date:** 2026-04-20
**Decider(s):** Claude Opus 4.7 (automated session) — epinnock@gmail.com
**Related task(s):** #42 (editor integration), #28 (native mount), source plan §MC3.14

## Context

The cf-expo-relay now exposes two distinct WebSocket surfaces that carry very
similar messages but serve different architectural tiers:

- **Legacy single-bundle channel** — `WS /session/:id`, message type
  `bundleUpdate`, handled by `OnlookRelayClient` + `LiveReloadDispatcher`
  (`apps/mobile-client/src/relay/wsClient.ts`, `.../liveReload.ts`). The
  relay emits `bundleUpdate` when the editor saves; the client fetches
  `/bundle/:id` and calls `OnlookRuntime.reloadBundle`.
- **Two-tier overlay channel** — `WS /hmr/:sessionId`, message type
  `overlay`, handled by `OverlayDispatcher` (`apps/mobile-client/src/relay/overlayDispatcher.ts`).
  The relay broadcasts overlays directly (they're small enough to ship over
  the WS frame). The mobile client evaluates them via
  `OnlookRuntime.reloadBundle` with no second fetch.

Both channels end at the same native primitive (`OnlookRuntime.reloadBundle(bundleSource)`).
The source plan (`plans/onlook-mobile-client-plan.md` Phase 3 / MC3.14) only
describes the legacy channel, but MC3.14's rationale — "this replaces stock
Expo Go's HMRClient.setup path entirely" — applies to both.

## Decision

**Ship both channels in parallel, gated by the
`NEXT_PUBLIC_MOBILE_PREVIEW_PIPELINE` feature flag.**

- `shim` (default): editor uses legacy path, mobile client runs
  `OnlookRelayClient` + `LiveReloadDispatcher` against `/session/:id`.
- `two-tier`: editor uses `TwoTierMobilePreviewPipeline`, mobile client
  runs `OverlayDispatcher` against `/hmr/:sessionId`. `startTwoTierBootstrap`
  owns lifecycle; the legacy client is not started.

Both can coexist on the relay without conflict — different URL paths, different
DO classes (`ExpoSession` vs `HmrSession`). The client picks exactly one per
boot.

## Alternatives considered

- **Option A (chosen): parallel channels behind the flag.** Lets us ship
  two-tier incrementally without regressing the legacy users. When two-tier
  proves out, flip default → `two-tier`, deprecate the shim path over one
  release, then delete `apps/mobile-client/src/relay/wsClient.ts` +
  `liveReload.ts` in a follow-up ADR.
- **Option B: fold overlays into the legacy `bundleUpdate` message shape.**
  Rejected — forces the relay to keep both the overlay fan-out cache and
  the old URL-fetch path alive forever; `bundleUpdate` messages carry a
  URL, overlays carry a full bundle body, so the clients diverge on a
  fundamental API shape.
- **Option C: replace the legacy channel outright now.** Rejected — the
  stock-Expo-Go fallback (source plan risks table: "Dual-shell
  maintenance burden") depends on the legacy channel working. Removing it
  breaks users on Expo Go. Defer to a later ADR once the custom client is
  the dominant distribution.

## Consequences

- **Positive:** Two-tier ships as an opt-in behind a single env flag; no
  stock-Expo-Go regression; `LiveReloadDispatcher` stays untouched as the
  fallback. Clear migration path — flip the default flag when ready.
- **Negative:** Two overlapping modules (`liveReload.ts` + `overlayDispatcher.ts`)
  live in `apps/mobile-client/src/relay/`. A reader grepping for "reload"
  will find both and has to consult this ADR to know which is canonical.
  Mitigated by inline file comments pointing at this ADR.
- **Neutral:** `MC3.14` stays "JS integration shipped 2026-04-11" for the
  legacy path; the two-tier equivalent is tracked under this session's
  `#42 / #50` (editor integration + bootstrap wiring).

## Open questions

- When the custom client graduates from TestFlight to the App Store (source
  plan Phase 6), is there still a reason to support the legacy `/session/:id`
  channel? Probably not — but answer that only when we have deploy data.

## References

- `apps/cf-expo-relay/src/worker.ts` — dispatch for both route families
- `apps/cf-expo-relay/src/session.ts` — legacy `ExpoSession` DO
- `apps/cf-expo-relay/src/do/hmr-session.ts` — `HmrSession` DO (overlay fan-out)
- `apps/mobile-client/src/relay/wsClient.ts` — legacy client
- `apps/mobile-client/src/relay/overlayDispatcher.ts` — two-tier client
- `apps/mobile-client/src/flow/twoTierBootstrap.ts` — lifecycle wiring
- `apps/web/client/src/services/mobile-preview/pipelines/two-tier.ts` — editor pipeline
- `plans/adr/two-tier-validation-strategy.md` — validation approach (this ADR's sibling)

# ADR-0009: Phase 11 legacy overlay path migration

**Status:** Proposed
**Date:** 2026-04-23
**Decider(s):** autonomous-loop
**Related task(s):** two-tier-overlay-v2 #89, #90, #91, #92, #93, #94

## Context

Phase 11 of the two-tier-overlay-v2 plan removes the legacy overlay wire paths:

- `wrapOverlayCode` (in `packages/browser-bundler/src/wrap-overlay.ts`) — emits a self-mounting IIFE that calls `globalThis.onlookMount`. Marked `@deprecated` since #16.
- `pushOverlay` (in `apps/web/client/src/services/expo-relay/push-overlay.ts`) — posts the legacy `OverlayMessage` wire shape `{type:'overlay', code, sourceMap?}`. Marked `@deprecated` since #16.
- Runtime consumers: `globalThis.onlookMount`, the B13 shell `eval` handler, legacy `cf-expo-relay/session.ts` bundle-storage behavior.

These coexist with the ABI v1 path (`wrapOverlayV1` + `pushOverlayV1` + `OverlayUpdateMessage` + `OnlookRuntime.mountOverlay`) which is fully shipped and validated end-to-end on real hardware as of Phase G (2026-04-22/23). Photographic DoD: `plans/adr/assets/v2-pipeline/post-g-{hello,updated}.png`.

The production editor pipeline — `apps/web/client/src/services/mobile-preview/pipelines/two-tier.ts` — still calls `wrapOverlayCode` + `pushOverlay`. The Phase G simulator mount runs through this path. A silent migration risks regressing the working flow.

## Decision

Phase 11 removal ships as a **flag-gated parallel v1 path inside `two-tier.ts`**, keeping the legacy branch active by default until every caller has flipped. Three-phase rollout (each is its own PR):

1. **Phase 11a — wire the v1 path.** Inside `two-tier.ts::sync()`, branch on `isOverlayV1PipelineEnabled()`:
   - **true:** call `wrapOverlayV1(result.code, { sourceMap, sourceBytes, meta: { buildDurationMs, sourceMapUrl? } })` + `pushOverlayV1({ relayBaseUrl, sessionId, overlay: { code, sourceMap, buildDurationMs }, assets: emptyManifest })`.
   - **false (default):** existing `wrapOverlayCode` + `pushOverlay` branch unchanged.
   - Add a Playwright spec pair in `apps/web/client/e2e/workers-pipeline/editor/overlay-v1-flag.spec.ts` that exercises both branches end-to-end against a mock relay.
   - **Phone-side dispatcher MUST accept both wire shapes** before the flip is safe. `apps/mobile-client/src/relay/overlayDispatcher.ts::handleRaw` tries `OverlayUpdateMessageSchema.safeParse` first and normalizes `source → code` so existing mount code reading `msg.code` works against both shapes. Preserves v1 metadata (`abi`, `sessionId`, `assets`, `meta`) as optional extensions on the message. 4 acceptance tests + regression tests against legacy pass together.
2. **Phase 11b — flip the default.** Change `getMobilePreviewPipeline()` in `src/utils/feature-flags/two-tier.ts` so an unset `NEXT_PUBLIC_MOBILE_PREVIEW_PIPELINE` returns `'overlay-v1'` instead of `'two-tier'` (or add a new explicit default). Run the full Phase G sim smoke test before merging; if anything regresses, this commit reverts cleanly.

   **Pre-flip check: phone runtime MUST be v1-capable.** Per `twoTierBootstrap.mount`, a v1 message on a runtime lacking `abi === 'v1'` + `mountOverlay` fails loudly with `status: 'failed'` + a config-drift diagnostic — the phone does NOT fall back to `reloadBundle` on a v1 envelope (the envelope self-evals but doesn't render, which would produce a false-positive "mounted" ack). Operator checklist before flipping the flag: every active phone session must be running a binary with `OnlookRuntime.mountOverlay` installed. Roll forward: upgrade phone binaries first, THEN flip the editor flag.

   **Phase 11b safety chain shipped 2026-04-25** — the pre-flip check above is now ENFORCED in code, not just operator-discipline. End-to-end:

   - **Phone side** — `apps/mobile-client/src/relay/abiHello.ts` (`buildPhoneAbiHello`) builds a `role: 'phone'` AbiHelloMessage from the runtime's capabilities. `OnlookRelayClient.abiHelloProvider` (`apps/mobile-client/src/relay/wsClient.ts`) fires the hello on every `onopen` (initial connect AND auto-reconnect). The live Spike B WS in `AppRouter.tsx` does the same so the existing Phase G mount path also handshakes.
   - **Relay** — `cf-expo-relay/src/do/hmr-session.ts` parses `abiHello` messages, fans them out to other connected sockets, and stores `lastEditorHelloPayload` / `lastPhoneHelloPayload` per-role so a fresh socket on either end gets a replay on connect (handles phone-stays-up + editor-reconnects). Structured logs `hmr.abi-hello.fwd` + `hmr.abi-hello.replay` surface handshake activity in the Workers tail.
   - **Editor side** — `apps/web/client/src/services/expo-relay/abi-hello.ts::startEditorAbiHandshake` arms on every WS open via `RelayWsClient.editorCapabilities` + `onAbiCompatibility`. Result is cached on `RelayWsClient.getLastAbiCompatibility()` (resets to `'unknown'` on socket close so a stale cache cannot leak across reconnects).
   - **Push gate** — `pushOverlayV1` now accepts a `compatibility` callback option and fails-closed pre-network when the gate returns `'unknown'` (handshake not yet completed) or an `OnlookRuntimeError` (incompatibility reported). Telemetry events from the gate carry `category: 'compat-gate'` so the soak dashboard segments them from network/validation failures.
   - **Production wiring** — `useMobilePreviewStatus` constructs the `RelayWsClient` with editor capabilities + onAbiCompatibility, captures the latest result in React state, and threads it through `MobilePreviewDevPanelContainer` → `MobileDevPanel`. The pipeline reads the same state via `compatibilityProvider` deps, so the push gate and the on-screen indicator share a single source of truth. `AbiCompatibilityIndicator` renders WAITING / OK / MISMATCH in the dev-panel header.
   - **Routing fix** — `resolveMobilePreviewPipelineConfig` now treats `kind: 'overlay-v1'` as a sub-mode of the `'two-tier'` pipeline (`b8ace3a2`), so setting `NEXT_PUBLIC_MOBILE_PREVIEW_PIPELINE=overlay-v1` actually reaches the v1 push path instead of silently falling through to shim.

   ~17 commits on `fix/expo-go-runtime-load` ship the chain. Test footprint added: +60 tests across `mobile-client` + `cf-expo-relay` + `web-client`. Typecheck clean across all touched packages. Operationally remaining for Phase 11b: re-validate Phase G sim smoke (Xcode 16.1 unblock) and run the 7-day soak.
3. **Phase 11c — delete legacy.** Once Phase 11b has soaked for 7 days without reports, remove:
   - `wrapOverlayCode`, `DEFAULT_OVERLAY_MOUNT_GLOBAL`, `WrapOverlayOptions`, `WrappedOverlay` from `packages/browser-bundler/src/wrap-overlay.ts` (and its test file)
   - `pushOverlay`, `OverlayMessage`, `buildOverlayMessage` from `push-overlay.ts` (keep `pushOverlayV1`)
   - legacy `globalThis.onlookMount` + B13 `eval` handler from `packages/mobile-preview/runtime/runtime.js`
   - legacy `cf-expo-relay/src/session.ts` bundle-storage code paths (keep the v1 `last-overlay-v1` DO storage key)
   - legacy `overlay` WS message type — but keep the `OverlayMessage` Zod schema as a `z.never()` parse-and-drop guard until Phase 11d, so a mis-versioned client surfaces cleanly.
4. **Phase 11d — final schema cleanup.** Remove the `z.never()` guards. `@deprecated` warnings removed from the wrap + push functions (they're now fully deleted).

## Alternatives considered

- **Silent migration inside `two-tier.ts`:** Rejected. The Phase G simulator flow is shipped working code; a cross-version swap without a flag could fail on-device in ways that don't reproduce in CI. The flag gate is a 10-line cost that buys a trivial rollback.
- **Parallel `overlay-v1.ts` pipeline file registered as a third pipeline kind:** Rejected. The pipeline selector already exposes `'overlay-v1'` as a flag value; adding a second pipeline kind that only differs in envelope shape is code duplication. Keep one pipeline file, branch internally.
- **Ship Phase 11c without a Phase 11a flag step:** Rejected. Removing `wrapOverlayCode` / `pushOverlay` without a staged rollout would break every caller listed in the codebase scan (15 files including e2e specs and the mobile-preview runtime tests). A flag lets us flip callers one at a time.

## Consequences

**Positive:**
- Rollback is a single env flag flip, not a revert.
- Phase 11a is merged without touching default behavior — zero regression risk.
- Every Phase G consumer stays on a tested path through the full migration.

**Negative:**
- Phase 11a adds a branch in the pipeline's hot path. Trivial cost; removed in Phase 11c.
- Phase 11a PR has to ship a dual-branch e2e spec to keep both paths covered.

**Neutral:**
- ABI v1's asset-manifest plumbing (empty manifest is valid per `pushOverlayV1`) means Phase 11a doesn't need the full Phase 7 asset pipeline wired into the editor — the v1 branch can ship with `assets: { abi: 'v1', assets: {} }` until Phase 9 asset work lands.

## Open questions

- **Who owns Phase 11b's soak period?** Needs a 7-day canary with metrics. ~~Current telemetry sinks (`pushOverlay`'s `onTelemetry` callback) are `console.info` by default — promoting to a real sink is prerequisite work.~~ **Soak sink shipped 2026-04-23** — `apps/web/client/src/services/expo-relay/overlay-telemetry-sink.ts` routes every push (legacy + v1) and every perf-guardrail crossing (push-slow, push-retried, large-overlay) through `posthog.capture` with `pipeline` tag `'overlay-v1' | 'overlay-legacy'`. Two-tier.ts wires both branches. PostHog-absent contexts (SSR, test harness) fall back to console.info/warn so dev visibility is preserved. Dashboard still needs to be built (sits on PostHog side); codebase side is done. 9 unit tests cover pipeline segmentation, payload shape, console fallback, never-throw.
- **Does `cf-expo-relay` need a kill-switch for the legacy WS overlay message type during Phase 11c → 11d?** Probably yes. The HmrSession's `isOverlayMessage` predicate should return `false` once Phase 11c ships so stale clients can't push legacy overlays.

## References

- `packages/browser-bundler/src/wrap-overlay.ts` — legacy wrapper (deprecated)
- `packages/browser-bundler/src/wrap-overlay-v1.ts` — ABI v1 wrapper (current)
- `apps/web/client/src/services/expo-relay/push-overlay.ts` — both `pushOverlay` and `pushOverlayV1`
- `apps/web/client/src/services/mobile-preview/pipelines/two-tier.ts` — the one editor-side caller to migrate
- `apps/web/client/src/utils/feature-flags/two-tier.ts` — pipeline flag + `isOverlayV1PipelineEnabled()`
- `plans/adr/overlay-abi-v1.md` — the target protocol
- `plans/adr/assets/v2-pipeline/post-g-{hello,updated}.png` — Phase G baseline screenshots
- `plans/two-tier-overlay-v2-task-queue.md` rows #89–#94

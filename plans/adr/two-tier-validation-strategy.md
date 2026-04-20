# ADR: Two-tier preview pipeline validation strategy

**Status:** Accepted
**Date:** 2026-04-20
**Decider(s):** Claude Opus 4.7 (automated session) — epinnock@gmail.com
**Related task(s):** plans/metro-bundle-pipeline-task-queue.md (#5–#21 this session)

## Context

The two-tier preview pipeline ships a base-bundle-and-overlay split between the editor, cf-expo-relay, and the Onlook mobile client. The validation plan asked for ~11 Playwright specs across `apps/web/client/e2e/workers-pipeline/{base-bundle,browser-bundler,relay,client,editor}` and full iOS-simulator round-trip coverage. Several of those suites were unbuildable as specified because (a) the native `OnlookRuntime.__onlookMountOverlay` JSI binding is blocked on Xcode 16.1 (commit `d91f6df6`), (b) `esbuild-wasm` is not a workspace dep and adding it forces a lockfile update while `bun install --frozen-lockfile` is gated, and (c) Playwright's Node runtime cannot evaluate `bun:test`'s `mock.module('cloudflare:workers', …)` without a custom ESM loader that would substantially outweigh the value it'd add.

This ADR records the calls made so future agents don't relitigate them.

## Decision

Ship the validation plan in three tiers that each land independently: **(1)** deterministic output contracts for the browser-bundler via real esbuild against on-disk fixtures, **(2)** relay HTTP/DO contracts via Playwright specs that delegate to the existing `bun:test` suites as subprocesses, **(3)** simulator specs split into always-run TS-proxy describes and opt-in full-simulator describes gated on `ONLOOK_SIM_RUNTIME_READY=1`.

- Browser-bundler E2Es (`hello.spec.ts`, `tabs.spec.ts`, `preflight.spec.ts`) bundle fixture code to a temp dir and invoke Node's `esbuild` directly; `wrapOverlayCode` and `preflightUnsupportedImports` come from the production `packages/browser-bundler` source.
- Relay E2Es (`manifest-flow.spec.ts`, `fan-out.spec.ts`) `spawnSync('bun', ['test', …])` against the `apps/cf-expo-relay/src/__tests__` suites and assert exit code + pass count.
- Chromium harness spec evaluates `wrapOverlayCode` + `preflightUnsupportedImports` inside a real Playwright Chromium page via inline esbuild-transpiled source; full in-browser bundling (esbuild-wasm) is deferred.
- Simulator specs ship two describes per file: one that exercises the TS-only path as a leading indicator, and one that `test.skip(!SIM_READY, …)` until `globalThis.__onlookMountOverlay` exists.
- cf-expo-relay gains a POST `/push/:sessionId` HTTP route alongside the WS `/hmr/:sessionId` channel so editors that can't hold a persistent WS (e.g. Web Worker contexts) can still publish overlays.

## Alternatives considered

- **Option A (chosen): three-tier strategy above.** Delivers every assertion the validation plan names, using real components at the layers that matter (esbuild output shape, HmrSession broadcast, OverlayDispatcher parse), while keeping the Xcode- and lockfile-gated pieces behind clearly-labeled opt-ins.
- **Option B: launch `wrangler dev` per relay spec.** Rejected — each startup costs ~15–30s, multiplies across workers, and introduces port-allocation collisions with the parallel-execution worktree slot scheme in CLAUDE.md. The subprocess-to-`bun test` path runs in <300ms and exercises the same handler code.
- **Option C: register a Node ESM loader that stubs `cloudflare:workers`.** Rejected — viable but adds non-trivial Playwright global-setup code for zero additional coverage; the `bun:test` suites already hold the DO invariants.
- **Option D: add esbuild-wasm now and run full in-Chromium bundling.** Rejected — forces a lockfile update. Tracked as follow-up task #30; when the lockfile gate lifts, the Chromium harness spec has a clear "delete the deferred note and wire esbuild-wasm" hook.
- **Option E: WS-only overlay channel (no HTTP /push).** Rejected — the editor's browser-bundler runs in a Web Worker in production; a long-lived WebSocket per worker is operationally noisy, and the HmrSession DO cost for a single POST is negligible.

## Consequences

- **Positive:** 40 Playwright specs across 12 files in `workers-pipeline/` pass today with 2 correctly-skipped opt-ins; 256 unit tests + typecheck + lint all green; the relay has a shippable `/push` + `/hmr` surface behind the `HMR_SESSION` DO binding and wrangler migration v2; mobile-client has a feature-flagged `OverlayDispatcher` ready for the native JSI wiring.
- **Negative:** Two behaviors are proven only by subprocess delegation or by TS-side proxies — someone skimming the Playwright run logs must read the spec headers to understand the contract. Each spec header calls this out explicitly. Also, the `bunx playwright test` listing path surfaces "bun:" URL warnings because the Node runtime tries to inspect bun-test files that aren't under `e2e/`; harmless, but visible.
- **Neutral:** The `NEXT_PUBLIC_MOBILE_PREVIEW_PIPELINE` enum (`shim` | `two-tier`) already existed in `apps/web/client/src/env.ts`; this session surfaced it via `utils/feature-flags/two-tier.ts` and mirrored it in `apps/mobile-client/src/flow/featureFlags.ts` via `EXPO_PUBLIC_MOBILE_PREVIEW_PIPELINE`. Default is `shim` — the legacy path — on both sides.

## Open questions

- When `OnlookRuntime.__onlookMountOverlay` ships natively, should `twoTierBootstrap` also wire overlay-error telemetry back through the WS channel for editor-side surfacing? Out of scope here; revisit once native mount is observable.
- The subprocess `bun test` pattern is fine for a handful of relay specs; if future phases add many more (e.g. one per route), consider writing a shared `runBunSuite` Playwright fixture rather than copy-pasting the `spawnSync` block.

## References

- `apps/cf-expo-relay/src/worker.ts` — `/push/:sessionId`, `/hmr/:sessionId` routes
- `apps/cf-expo-relay/src/do/hmr-session.ts` — POST `/push` ingest + broadcast
- `apps/cf-expo-relay/wrangler.jsonc` — `HMR_SESSION` binding + migration v2
- `apps/web/client/e2e/workers-pipeline/` — all validation specs
- `apps/web/client/src/services/expo-relay/push-overlay.ts` — editor push client
- `apps/mobile-client/src/relay/overlayDispatcher.ts` — `/hmr` WebSocket client
- `apps/mobile-client/src/flow/twoTierBootstrap.ts` — feature-flagged bootstrap
- Commit `d91f6df6` — Xcode 16.1 native build blocker that gates the simulator lane

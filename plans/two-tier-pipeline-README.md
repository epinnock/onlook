# Two-tier preview pipeline — contributor guide

**Status:** Shipping on `feat/two-tier-bundle` as of 2026-04-20. Feature-flagged off by default; the legacy `shim` path is untouched.

## What this is

The two-tier pipeline replaces the "rebuild + push full Metro bundle on every edit" preview flow with a split:

- **Base bundle** (heavy, shipped once): the React Native + Expo + shim modules your fixture depends on, produced by `@onlook/base-bundle-builder` and stored in Cloudflare R2.
- **Overlay** (light, re-shipped every edit): just the user's app code, produced by `@onlook/browser-bundler` inside an editor Web Worker, pushed to the relay as a CJS string wrapped with `globalThis.__onlookMountOverlay(…)`.

The mobile client mounts the base bundle once, then the overlay hot-swaps the app-level code on each edit.

## Wire diagram

```
 Editor (Web Worker)                         cf-expo-relay                   Mobile client (iOS)
 ─────────────────────                       ─────────────                   ─────────────────────
 @onlook/browser-bundler                      POST /push/:id                  OverlayDispatcher
   │  esbuild-wasm against virtual-fs         │   → HmrSession DO              │   WS /hmr/:id
   │  preflight(unsupported imports)          │   → persists last overlay      │
   │  wrapOverlayCode()                       │   → broadcasts to listeners    │
   │                                          │                                │
   ▼                                          ▼                                ▼
 pushOverlay({ relayBaseUrl, sessionId, overlay })      (fan-out)         __onlookMountOverlay(code)
   (apps/web/client/src/services/expo-relay)            WebSocket         (native JSI, Xcode-blocked)
```

## Feature flag

**Editor:** `NEXT_PUBLIC_MOBILE_PREVIEW_PIPELINE` in `apps/web/client/.env.local`:

```bash
NEXT_PUBLIC_MOBILE_PREVIEW_PIPELINE=two-tier   # opt in
# (or unset, or =shim, for the legacy path)
```

Consume in code via `isTwoTierPipelineEnabled()` from `@/utils/feature-flags/two-tier`.

**Mobile client:** `EXPO_PUBLIC_MOBILE_PREVIEW_PIPELINE` (set via `expo start --env-file` or EAS build env). Consume via `isTwoTierPipelineEnabled()` from `apps/mobile-client/src/flow/featureFlags`.

**Fail-closed default:** any value other than exactly `two-tier` falls back to `shim`. This prevents accidental env misconfigurations from enabling the new path.

## Key files

| Concern | Path |
|---|---|
| Base bundle builder | `packages/base-bundle-builder/` |
| Browser overlay bundler | `packages/browser-bundler/` |
| Overlay wire schema | `packages/mobile-client-protocol/src/overlay.ts` |
| Relay `/push` + `/hmr` routes | `apps/cf-expo-relay/src/worker.ts` |
| Relay fan-out DO | `apps/cf-expo-relay/src/do/hmr-session.ts` |
| Wrangler config (HMR_SESSION binding, migration v2) | `apps/cf-expo-relay/wrangler.jsonc` |
| Editor push client | `apps/web/client/src/services/expo-relay/push-overlay.ts` |
| Editor feature flag | `apps/web/client/src/utils/feature-flags/two-tier.ts` |
| Mobile OverlayDispatcher | `apps/mobile-client/src/relay/overlayDispatcher.ts` |
| Mobile bootstrap | `apps/mobile-client/src/flow/twoTierBootstrap.ts` |
| Mobile feature flag | `apps/mobile-client/src/flow/featureFlags.ts` |
| Validation ADR | `plans/adr/two-tier-validation-strategy.md` |
| Task queue | `plans/metro-bundle-pipeline-task-queue.md` |

## Relay routes (new)

- `WS /hmr/:sessionId` — editor + mobile both connect. Session id regex: `^[A-Za-z0-9_-]{1,128}$`.
- `POST /push/:sessionId` — HTTP overlay upload (Web Worker-friendly, no persistent WS required). Accepts `application/json` only, body ≤ 2 MiB. Returns `{ delivered: N }` with HTTP 202. CORS-aware via `ALLOWED_PUSH_ORIGINS`.

The HmrSession DO persists the last overlay to `DurableObjectStorage` under the key `last-overlay` so late-joining clients get an immediate replay after reconnect.

## Running the validation suite

```bash
# Unit + typecheck gates (fast; ~1s each)
bun test packages/base-bundle-builder/__tests__/*.test.ts
bun test packages/browser-bundler/__tests__/*.test.ts
bun test packages/mobile-client-protocol/__tests__/overlay.test.ts
bun test apps/mobile-client/src/relay/__tests__/overlayDispatcher.test.ts
bun test apps/mobile-client/src/flow/__tests__/*.test.ts
bun test apps/web/client/src/services/expo-relay/__tests__/push-overlay.test.ts
bun --filter @onlook/base-bundle-builder typecheck
bun --filter @onlook/browser-bundler typecheck
(cd apps/cf-expo-relay && bun test 'src/__tests__/*.test.ts' 'src/__tests__/routes/*.test.ts' && bun run typecheck)

# Playwright E2Es (real esbuild + real loopback HTTP relay + real OverlayDispatcher)
bunx playwright test apps/web/client/e2e/workers-pipeline/
```

Expected result: `256 unit tests + 42 Playwright specs` all green, with 2 of the Playwright specs opt-in-skipped (see next section).

## The iOS simulator lane

Two Playwright describes under `apps/web/client/e2e/workers-pipeline/client/` stay `test.skip()`'d until the native `OnlookRuntime.__onlookMountOverlay(code)` JSI binding ships. That work is gated on the Xcode 16.1 device-build blocker (commit `d91f6df6`).

When the native binding lands, opt in via:

```bash
export ONLOOK_SIM_RUNTIME_READY=1
bunx playwright test apps/web/client/e2e/workers-pipeline/client/
```

Both describes flip from 2 skipped → 2 passing.

## Gotchas learned in validation

- **Real esbuild rejects non-absolute paths** — `packages/browser-bundler`'s virtual-fs-resolve plugin returns paths without a leading slash, which is incompatible with real esbuild running in `file` namespace. The Playwright spec `helpers/browser-bundler-harness.ts` materializes fixtures to a real tempdir to sidestep this; in-browser esbuild-wasm will hit the same issue if we ever enable it directly — either rewrite the plugin to return absolute paths or keep the temp-dir workaround.
- **Bun's `mock.module` is not Playwright-compatible.** Relay E2Es delegate to `bun test` via `spawnSync` rather than replicating the Cloudflare Workers module stub inside Playwright's Node runtime. If we end up with many more relay E2Es, extract `runBunSuite` into a shared fixture.
- **Lockfile is gated.** New workspace deps or `esbuild-wasm` additions can't land until `bun install --frozen-lockfile` is intentionally updated. The Chromium harness spec (`browser-bundler/chromium-harness.spec.ts`) is written to work without `esbuild-wasm` today and has a clear "delete this note and wire esbuild-wasm" TODO marker.

## Who owns what

- The editor Web Worker that calls `pushOverlay` and `createIncrementalBundler` will be the next landing — see the queue for the integration tasks.
- The native JSI mount (`OnlookRuntime.__onlookMountOverlay`) is owned by the mobile-client iOS runtime author.
- The relay worker + HmrSession DO are ops-owned; config lives in `apps/cf-expo-relay/wrangler.jsonc` and the ALLOWED_PUSH_ORIGINS secret.

## Further reading

- `plans/adr/two-tier-validation-strategy.md` — why we chose the three-tier validation approach.
- `plans/metro-bundle-pipeline-task-queue.md` — the full task queue with current status snapshot.
- `plans/test-failure-audit-2026-04-20.md` — audit of the 46 pre-existing test failures that predate this branch.

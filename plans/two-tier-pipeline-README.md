# Two-tier preview pipeline — contributor guide

**Status:** Shipping on `feat/two-tier-bundle` as of 2026-04-20. Feature-flagged off by default; the legacy `shim` path is untouched.

> **2026-04-21 update — Overlay ABI v1 in progress.** The sections below describe the
> pre-ABI design (Spike B shim path). ABI v1 redefines the wire contract and runtime
> globals to eliminate dialect drift across editor/relay/runtime/native layers. See
> [`plans/adr/overlay-abi-v1.md`](adr/overlay-abi-v1.md) for the new contract and
> [`plans/two-tier-overlay-v2-task-queue.md`](two-tier-overlay-v2-task-queue.md) for
> the 100-task migration queue + live status log. Migration is incremental — the
> sections below remain accurate for the currently-shipping legacy product path until
> the cleanup wave (tasks #89–#94) retires it.

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

**ABI v1 (primary path — `NEXT_PUBLIC_MOBILE_PREVIEW_PIPELINE=overlay-v1`):**

| Concern | Path |
|---|---|
| ABI contract | `plans/adr/overlay-abi-v1.md` |
| 100-task queue | `plans/two-tier-overlay-v2-task-queue.md` |
| Wire schemas + version guards | `packages/mobile-client-protocol/src/abi-v1.ts` |
| Runtime-capability classifier | `packages/base-bundle-builder/src/runtime-capabilities.ts` |
| Base manifest emitter | `packages/base-bundle-builder/src/base-manifest.ts` |
| Alias-map sidecar wiring | `packages/base-bundle-builder/src/build.ts` |
| REQUIRED_ALIASES enforcement | `packages/base-bundle-builder/src/validate-aliases.ts` |
| Hermes-safe overlay wrapper | `packages/browser-bundler/src/wrap-overlay-v1.ts` |
| Editor preflight (ABI v1) | `packages/browser-bundler/src/preflight.ts` (`preflightAbiV1Imports`) |
| JS-fallback OnlookRuntime | `packages/mobile-preview/runtime/src/onlook-runtime-js.ts` |
| Relay overlayUpdate routing | `apps/cf-expo-relay/src/do/hmr-session.ts` |
| Editor push client (v1) | `apps/web/client/src/services/expo-relay/push-overlay.ts` (`pushOverlayV1`) |
| ABI-hello handshake | `apps/web/client/src/services/expo-relay/abi-hello.ts` |
| Reconnect replayer | `apps/web/client/src/services/expo-relay/reconnect-replayer.ts` |
| Editor status machine | `apps/web/client/src/services/expo-relay/overlay-status.ts` |
| Editor debouncer | `apps/web/client/src/services/expo-relay/overlay-debounce.ts` |
| Overlay source-map tooling | `apps/web/client/src/services/expo-relay/overlay-sourcemap.ts` |
| Editor feature flag | `apps/web/client/src/utils/feature-flags/two-tier.ts` (`isOverlayV1Enabled`) |
| Mobile feature flag | `apps/mobile-client/src/flow/featureFlags.ts` (`isOverlayV1Enabled`) |
| Mobile mount entrypoint | `apps/mobile-client/src/navigation/AppRouter.tsx` (prefers `OnlookRuntime.mountOverlay`) |
| Mobile QR flow | `apps/mobile-client/src/flow/qrToMount.ts` (prefers `OnlookRuntime.mountOverlay`) |
| Dev-menu reload | `apps/mobile-client/src/actions/reloadBundle.ts` (uses cached `lastMount`) |
| E2E harness | `packages/browser-bundler/__tests__/two-tier-e2e.spec.ts` |

**Legacy path (retiring — `NEXT_PUBLIC_MOBILE_PREVIEW_PIPELINE=two-tier`):**

| Concern | Path |
|---|---|
| Overlay wire schema (legacy) | `packages/mobile-client-protocol/src/overlay.ts` |
| Legacy wrap-overlay | `packages/browser-bundler/src/wrap-overlay.ts` (`@deprecated`) |
| Legacy push-overlay | `apps/web/client/src/services/expo-relay/push-overlay.ts` (`pushOverlay`, `@deprecated`) |
| Mobile OverlayDispatcher | `apps/mobile-client/src/relay/overlayDispatcher.ts` |
| Mobile bootstrap | `apps/mobile-client/src/flow/twoTierBootstrap.ts` |
| Legacy ExpoSession DO | `apps/cf-expo-relay/src/session.ts` (scheduled removal) |
| Validation ADR | `plans/adr/two-tier-validation-strategy.md` |
| Legacy task queue | `plans/metro-bundle-pipeline-task-queue.md` |

Legacy removal is tracked as Phase 11 tasks #89–#94 in the v2 queue; the `overlay-v1` feature-flag kill switch gates traffic between the two paths during migration.

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

## Validation recipes

Three tiers of validation exist. Each is cheap to rerun and lives in source so
every contributor can reproduce the green bar.

### Tier 1 — unit + Node E2E (runs anywhere, ~1s)

```bash
bun test packages/base-bundle-builder/__tests__/*.test.ts
bun test packages/browser-bundler/__tests__/*.test.ts
bun test packages/mobile-client-protocol/__tests__/overlay.test.ts
bun test packages/mobile-preview/runtime/__tests__/overlay-mount.test.ts
bun test apps/mobile-client/src/relay/__tests__/overlayDispatcher.test.ts
bun test apps/mobile-client/src/flow/__tests__/*.test.ts
bun test apps/web/client/src/services/expo-relay/__tests__/push-overlay.test.ts
bun test apps/web/client/src/services/mobile-preview/pipelines/__tests__/two-tier.test.ts
bun --filter @onlook/base-bundle-builder typecheck
bun --filter @onlook/browser-bundler typecheck
(cd apps/cf-expo-relay && bun test 'src/__tests__/*.test.ts' 'src/__tests__/routes/*.test.ts' && bun run typecheck)

bunx playwright test apps/web/client/e2e/workers-pipeline/
```

Expected baseline (2026-04-20): 286 unit tests + 49 Playwright specs (2 of them
opt-in-skipped until `ONLOOK_SIM_RUNTIME_READY=1`), typecheck green across
base-bundle-builder + browser-bundler + cf-expo-relay.

### Tier 2 — Chromium (Playwright MCP / `chrome-devtools` MCP)

Drives the editor's preview UI inside a real Chromium page. Useful to verify
the feature-flag gate actually flips the hot path at runtime.

```bash
# From repo root (starts Next.js dev on WEB_PORT)
export PREVIEW_SLOT=0
export WEB_PORT=$((3100 + PREVIEW_SLOT))
export NEXT_PUBLIC_MOBILE_PREVIEW_PIPELINE=two-tier
export NEXT_PUBLIC_CF_EXPO_RELAY_URL=http://127.0.0.1:8787
bun run dev:client
```

Then, from a Claude Code / Playwright MCP-capable client, drive:

1. `navigate_page` → `http://127.0.0.1:3100/project/<id>`
2. Open the QR preview modal.
3. `list_console_messages` — look for `[onlook.push-overlay]` telemetry events
   (structured `console.info` from `pushOverlay`) confirming the hot path
   went through `TwoTierMobilePreviewPipeline`.
4. `list_network_requests` — confirm POST to
   `http://127.0.0.1:8787/push/<sessionId>` fires on file-save events.

The Chromium harness Playwright spec (`apps/web/client/e2e/workers-pipeline/browser-bundler/chromium-harness.spec.ts`)
automates the analogous checks headlessly via esbuild-wasm inside the page.

### Tier 3 — iOS simulator (Mac mini, Xcode 16.4)

End-to-end proof that the runtime's `OnlookRuntime.reloadBundle` accepts the
self-mounting overlay format. Requires the Mac mini (`scry-farmer@192.168.0.17`)
or any host with Xcode ≥ 16.1.

```bash
# On the Mac mini
cd ~/build/onlook
git fetch origin feat/two-tier-bundle
git reset --hard origin/feat/two-tier-bundle
bun install
(cd packages/mobile-preview && bun run build:runtime)
(cd apps/mobile-client && bun run mobile:build:ios)

SIM=4D5CF9DA-F272-401C-BC5B-3C932CC5987B   # iPhone 16
APP=$(find ~/Library/Developer/Xcode/DerivedData -name OnlookMobileClient.app \
  -path '*/Debug-iphonesimulator/*' -type d | head -1)
xcrun simctl install "$SIM" "$APP"
xcrun simctl launch "$SIM" com.onlook.mobile
sleep 5
xcrun simctl spawn "$SIM" log show --last 1m --predicate \
  'processImagePath CONTAINS "OnlookMobileClient"' | \
  grep -E 'onlook-runtime|reloadBundle'
```

Expected lines: `[onlook-runtime] hermes ready`, `composed combined bundle (~1.6MB)`,
`Fabric tap bridge attached`. The baked runtime file SHA matches
`packages/mobile-preview/runtime/bundle.js`. Grep `__onlookMountOverlay` against
the combined bundle must return 0 (shim removed).

For the full editor → overlay → simulator round-trip, run Tier 2 (editor) +
Tier 3 (sim) in parallel with a real relay in between:

```bash
# Terminal A (local): relay
cd apps/cf-expo-relay && bunx wrangler dev --port 8787 --local

# Terminal B (local): editor dev with two-tier flag
export NEXT_PUBLIC_MOBILE_PREVIEW_PIPELINE=two-tier
export NEXT_PUBLIC_CF_EXPO_RELAY_URL=http://<LAN-IP>:8787
bun run dev:client

# Terminal C (Mac mini SSH): booted simulator pointed at the LAN relay
# via an onlook:// deeplink:
ssh -i ~/.ssh/spectra-macmini scry-farmer@192.168.0.17 \
  "xcrun simctl openurl 4D5CF9DA-F272-401C-BC5B-3C932CC5987B \
   'onlook://launch?session=manual&relay=http%3A%2F%2F<LAN-IP>%3A8787%2Fmanifest%2Fmanual'"
```

Edit `App.tsx` in the editor → `pushOverlay` POSTs to `/push/manual` → HmrSession
broadcasts → the device's `OverlayDispatcher` receives the overlay →
`OnlookRuntime.reloadBundle` eval's the self-mounting bundle → renderApp picks
up the new component.

When this flow stays green after an arbitrary edit, set
`ONLOOK_SIM_RUNTIME_READY=1` and the opt-in Playwright describes in
`workers-pipeline/client/` will run — they're currently auto-skipped.

## Further reading

- `plans/adr/two-tier-validation-strategy.md` — why we chose the three-tier validation approach.
- `plans/metro-bundle-pipeline-task-queue.md` — the full task queue with current status snapshot.
- `plans/test-failure-audit-2026-04-20.md` — audit of the 46 pre-existing test failures that predate this branch.

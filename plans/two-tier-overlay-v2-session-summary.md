# Two-tier overlay v2 — session summary (2026-04-21)

A single day's working session landed ABI v1 and ~65 discrete tasks across six
commits on `feat/two-tier-bundle`. This doc captures what shipped, what was
intentionally deferred, and where a future contributor should pick up.

## Authoritative anchors

- **ADR:** [`plans/adr/overlay-abi-v1.md`](adr/overlay-abi-v1.md) — the
  contract every layer targets. Includes §"Integration recipe" showing the
  canonical editor wire-up.
- **Queue:** [`plans/two-tier-overlay-v2-task-queue.md`](two-tier-overlay-v2-task-queue.md) — 100-task migration queue with status log.
- **Key-file table:** [`plans/two-tier-pipeline-README.md`](two-tier-pipeline-README.md) — split into "ABI v1 (primary)" and "Legacy (retiring)" sections.

## Commits on `feat/two-tier-bundle`

| SHA | Scope |
|---|---|
| `a88282c3` | ABI v1 contract + full non-native pipeline (45 files, +5272/-191) |
| `e4175477` | Phase 8/9/12 — relay observability + editor helpers + negative tests |
| `1af01972` | Phase 6/7/9/12 — asset pipeline + editor composers + pure-JS artifacts |
| `ce36ea55` | Session wrap — pipeline-flag v1 + legacy proxy + ADR recipe |
| `6a3516cc` | Phase 5/7/10 — resolvers + registry shim + jsx-source + overlayAck |
| *pending* | Phase 5/6/8/9 cleanup — dir-index resolver + pure-JS fixtures + ack routing both sides + legacy regression |

## What ships

### Protocol
- **Single ABI contract** (`packages/mobile-client-protocol/src/abi-v1.ts`) —
  `OverlayUpdateMessage`, `AbiHelloMessage`, `OverlayAckMessage`,
  `OverlayAssetManifest`, `BaseManifest`, `RuntimeCapabilities`,
  `OnlookRuntimeError`. Zod-validated. Version guards (`checkAbiCompatibility`,
  `assertOverlayAbiCompatible`).
- **Legacy proxy** — `overlay.ts` re-exports v1 types so migrating callers
  don't rename-sweep during the transition.

### Base bundle builder
- **Runtime capability classifier** (`runtime-capabilities.ts`) — REQUIRED /
  OPTIONAL / DISALLOWED tiers + `classifyImport` + `buildRuntimeCapabilities`.
- **Base manifest emitter** (`base-manifest.ts`) with sha256 `bundleHash` /
  `aliasHash`.
- **Alias-sidecar wiring** in `build.ts` — every Metro build auto-emits
  `aliasEmitterOutput`.
- **REQUIRED_ALIASES enforcement** in `validate-aliases.ts`.

### Browser bundler
- **wrapOverlayV1** — Hermes-safe CJS IIFE + size caps (soft 512 KB / hard
  2 MB) + `isHermesSafeOverlay` guardrail.
- **preflightAbiV1Imports** — editor-side policy gate with
  `unsupported-native` / `unknown-specifier` kinds.
- **Platform resolver** (`platform-resolver.ts`) — `.ios/.android → .native →
  generic` priority + `resolveDirectoryIndex`.
- **Package resolver** (`package-resolver.ts`) — `react-native > exports >
  module > main` field priority + subpath maps.
- **Pure-JS artifact format** (`pure-js-package.ts`) + in-memory cache +
  `mergePureJsArtifactIntoOverlay` + lodash/zod fixtures.
- **__source injector stub** (`plugins/jsx-source.ts`) for tap-to-source.

### Runtime
- **JS-fallback OnlookRuntime** (`packages/mobile-preview/runtime/src/
  onlook-runtime-js.ts`) — install guard, require via alias map + Metro
  registry, mountOverlay with eval + `__pendingEntry` + renderApp, unmount,
  resolveAsset, preloadAssets (validating), loadFont (with asset-kind check),
  error classification. 23 tests.
- **AssetRegistry shim** (`asset-registry-shim.ts`) — translates overlay
  asset descriptors to Metro AssetRegistry shape.

### Relay (`apps/cf-expo-relay`)
- **HmrSession overlayUpdate routing** with ABI v1 validation +
  `last-overlay-v1` persistence + replay to new clients.
- **Phone→editor onlook:* fanout** — console / network / error / select /
  tap / overlayAck all validated + broadcast.
- **Legacy fallthrough** — existing `overlay` / `bundleUpdate` shapes preserved.

### Editor service layer (`apps/web/client/src/services/expo-relay`)
- `pushOverlayV1` — `OverlayUpdateMessage` wire shape with sha256
  `overlayHash`.
- `abi-hello` — editor handshake helper with `checkAbiCompatibility` gate.
- ~~`reconnect-replayer`~~ — superseded 2026-04-25 by hook-level
  `useMobilePreviewStatus` recovery (commit `c191fc0d`); module
  deleted in `0ae3179c`. The hook detects the
  `abiCompatibility` 'unknown'→'ok' transition and triggers a
  manual `pipeline.sync()` instead of the standalone re-push helper.
- `overlay-status` — MobX-friendly state machine (idle → building →
  uploading-assets → sent → mounted | error).
- `overlay-debounce` — 150 ms trailing debounce with injectable clock.
- `overlay-pipeline` — composes debouncer + pushOverlayV1 + status machine.
- `overlay-sourcemap` — fetch + VLQ decode + frame resolve + error decorator
  (no `source-map` dep).
- `asset-check` / `asset-uploader` / `asset-metadata` — full content-hash
  upload flow.
- `relay-events` — multiplexed phone→editor listener including
  `onOverlayAck`.
- `preflight-formatter` — turns preflight issues into status-bar /
  error-panel renderings.
- `perf-guardrails` — push-slow / build-slow / retried warnings.
- `overlay-size-delta` — grow/shrink telemetry with thresholds.

### Mobile client
- **AppRouter** prefers `OnlookRuntime.mountOverlay` when `abi === 'v1'`.
- **qrToMount** routes all scans through `mountOverlay` in v1 mode (no
  runApplication/reloadBundle split).
- **Dev-menu reload** uses cached `lastMount.source` for session-preserving
  hot reload.
- **Feature flag** — `overlay-v1` kill-switch value on both editor + mobile
  sides.

### Tests
- **1834 pass / 2 skip / 1 fail** across 158 test files (1 pre-existing
  Hermes-mode shell.js test unrelated to this work — shell.js untouched).
- **E2E Node harness** (`two-tier-e2e.spec.ts`) — esbuild → wrap → push →
  relay → mountOverlay composes in 132 ms.
- **Playwright editor spec** (`overlay-v1-dispatch.spec.ts`) — barrel
  exports, feature-flag gating, wire shape.
- **Typecheck clean** across `@onlook/mobile-client-protocol`,
  `@onlook/base-bundle-builder`, `@onlook/browser-bundler`,
  `@onlook/cf-expo-relay`, editor services.

## What's deferred (and why)

| Item | Blocker |
|---|---|
| Native JSI `OnlookRuntime.mountOverlay` / `runApplication` host fns | Xcode 16.1 required (commit `d91f6df6`) |
| Actual Metro programmatic base-bundle build | Needs running RN environment |
| Physical-device dogfooding | Device + Xcode required |
| Full multi-module overlay table (`__modules` / `__map` per ADR) | esbuild collapses today; not needed until multi-file overlay-local imports need independent cache |
| `__source` esbuild plugin wiring | Injector function done; full onLoad integration ships with Phase 10 |
| Pure-JS artifact install/update flow | Artifact format done; editor UI + cache warming is a Phase 6 follow-up |
| Legacy cleanup (tasks #89–#94) | Gated on flipping `overlay-v1` flag on in production |

## How to resume

1. **Confirm ABI ratification** — the ADR is marked "Proposed". Human sign-off moves it to "Accepted".
2. **Native path** — once Xcode unblocks: wire `OnlookRuntimeInstaller::install()` to register `runApplication` / `reloadBundle` as JSI host functions. The JS-fallback runtime is the test harness.
3. **Flip the flag** — set `NEXT_PUBLIC_MOBILE_PREVIEW_PIPELINE=overlay-v1` in staging, verify the Playwright E2E + editor manual smoke, then flip production.
4. **Cleanup wave** — retire `wrapOverlayCode`, `pushOverlay`, `ExpoSession` DO, `shell.js` B13 block (tasks #89–#94).

# Phase 11b soak dashboard — operator playbook

**Status:** Proposed
**Date:** 2026-04-23
**Related:** ADR-0009 Phase 11b, `apps/web/client/src/services/expo-relay/overlay-telemetry-sink.ts`

## Purpose

When Phase 11b flips `NEXT_PUBLIC_MOBILE_PREVIEW_PIPELINE` to `overlay-v1` by default, we need a 7-day canary that compares the v1 population against the legacy baseline. The telemetry sink is shipped; this doc tells the operator (a) what events fire, (b) which queries answer the canary questions, and (c) what thresholds should stop the rollout.

The sink code is at `apps/web/client/src/services/expo-relay/overlay-telemetry-sink.ts`. Events flow through `posthog.capture` in every browser session that reaches the mobile-preview flow. SSR, test harness, and any environment without PostHog initialized fall back to `console.info/warn` — dashboard visibility requires the client to be browser-side with PostHog live.

## Events and payloads

### `onlook_overlay_push` — every overlay push

Fires once per push (success or failure) from both pipeline branches. Payload:

| Field | Type | Notes |
|---|---|---|
| `pipeline` | `'overlay-v1' \| 'overlay-legacy'` | Primary segmentation dimension |
| `sessionId` | string | Mobile-preview session; same id across the life of a phone connection |
| `attempts` | number | 1 on first-try success; >1 means retries happened |
| `durationMs` | number | Wall-clock from pushOverlay entry to resolve |
| `bytes` | number | Overlay code size at the wire |
| `delivered` | number? | How many sockets the relay fanned out to |
| `status` | number? | HTTP status from the relay |
| `ok` | boolean | Push result |
| `error` | string? | Error string when `ok=false` |

### `onlook_overlay_perf` — perf-guardrail threshold crossings

Fires only when a push crosses an ADR-0001 §"Performance envelope" threshold. Payload:

| Field | Type | Notes |
|---|---|---|
| `pipeline` | `'overlay-v1' \| 'overlay-legacy'` | Primary segmentation dimension |
| `category` | `'push-slow' \| 'push-retried' \| 'large-overlay' \| 'build-slow'` | Which threshold was crossed |
| `severity` | `'warn' \| 'info'` | warn for push-slow/large-overlay/build-slow hard-cap; info for push-retried and soft-cap large-overlay |
| `message` | string | Human-readable detail |
| `sessionId`, `durationMs`, `bytes`, `attempts`, `ok` | (various) | Flattened from the underlying push telemetry |

Coverage (post-2026-04-23 wiring):
- `push-slow` and `push-retried` — both pipelines, via `evaluatePushTelemetry` in every `onTelemetry` callback.
- `large-overlay` — both pipelines, via `checkOverlaySize` on the wrapped output (legacy emits info/warn but does NOT fail the push; v1 emits then throws on `fail-hard`).
- `build-slow` — both pipelines, via `evaluateBuildDuration` on the measured `buildDurationMs`.

### `onlook_overlay_pipeline_marker` — operator pivot markers

Emitted manually by `emitOverlayPipelineMarker({ kind, pipeline, note? })` from `apps/web/client/src/services/expo-relay/overlay-telemetry-sink.ts`. Purpose: draw vertical lines on the Phase 11b timeline charts for boundary events.

| Field | Type | Notes |
|---|---|---|
| `kind` | string | Free-form; common values: `'flag-flip'`, `'phone-binary-rollout'`, `'operator-check-in'` |
| `pipeline` | `'overlay-v1' \| 'overlay-legacy'` | Which pipeline the marker refers to |
| `note` | string? | Optional annotation shown inline on the timeline |
| `emittedAt` | number | `Date.now()` at call time |

Typical use, pasted into the browser devtools when the editor is loaded:
```js
// Before flipping the flag:
emitOverlayPipelineMarker({ kind: 'flag-flip', pipeline: 'overlay-v1', note: 'Phase 11b T0 — canary begins' });
```
Dashboard queries can filter on `properties.kind` to align before/after windows without guessing deployment timestamps.

## Canary questions + PostHog query recipes

All queries use PostHog's `events` source, filtered by the event name. Breakdown or group-by `properties.pipeline` to split v1 vs legacy.

### Q1 — push success rate by pipeline

**Motivation.** The single biggest signal: if v1 pushes fail more often than legacy, flip the flag back.

```
Events: onlook_overlay_push
Breakdown: properties.pipeline
Formula: sum(properties.ok=true) / count(*)
Window: rolling 1h, rolling 24h
Pass gate: v1 rate >= 99% of legacy rate AND v1 absolute rate >= 98%
Stop gate: v1 absolute rate < 97% for any 30-min window
```

### Q2 — p95 push latency by pipeline

**Motivation.** v1 shouldn't be materially slower. Build-time latency is captured separately (`onlook_overlay_perf` category=build-slow) but push latency is the user-observable signal.

```
Events: onlook_overlay_push
Breakdown: properties.pipeline
Formula: p95(properties.durationMs)
Window: rolling 1h
Pass gate: v1 p95 <= legacy p95 + 100ms
Stop gate: v1 p95 > legacy p95 + 300ms for any 30-min window
```

### Q3 — retry rate by pipeline

```
Events: onlook_overlay_push
Filter: properties.attempts > 1
Breakdown: properties.pipeline
Formula: count(*) / total_pushes
Pass gate: v1 retry rate <= legacy rate + 1% absolute
```

### Q4 — large-overlay frequency

**Motivation.** v1 envelope is structurally ~1.5x larger than legacy due to the hello/meta header. Confirm the soft-cap (512 KB) crossing rate doesn't balloon.

```
Events: onlook_overlay_perf
Filter: properties.category = 'large-overlay'
Breakdown: properties.pipeline
Formula: count(*) / total_pushes  (pair with Q1 denominator)
Pass gate: v1 soft-cap rate <= legacy rate + 0.5% absolute
```

### Q5 — error-kind distribution (v1 only)

**Motivation.** v1 envelope surfaces classification errors (`overlay-parse`, `abi-mismatch`, `unsupported-native`) that legacy couldn't express. A spike in `abi-mismatch` = phones lagging editor; a spike in `unsupported-native` = curated alias list needs expansion.

```
Events: onlook_overlay_push
Filter: properties.ok = false AND properties.pipeline = 'overlay-v1'
Breakdown: properties.error
Formula: count(*)
Alert threshold: any single error string > 10/hour sustained
```

### Q5b — phone-side mount latency (eval-slow signal)

**Motivation.** ADR-0001 §"Performance envelope" targets ≤100ms eval latency on a 2-year-old iPhone. The phone populates `OverlayAckMessage.mountDurationMs` with the wall-clock time spent in `mountOverlay` (see `packages/mobile-client-protocol/src/abi-v1.ts`). Editor-side capture flows through `RelayWsClient.snapshot().acks` → `MobileOverlayAckTab` (dev panel). To land this in PostHog, an editor-side subscription to `onOverlayAck` needs to call `emitOverlayPushTelemetry`-equivalent for the ack; that wiring is still TODO at time of writing (the schema + dev-panel-render pieces landed 2026-04-23).

Once ack-side PostHog emission is wired, the expected query shape:

```
Events: onlook_overlay_ack  (event name TBD — not live yet)
Filter: properties.pipeline = 'overlay-v1' AND has(properties.mountDurationMs)
Formula: p95(properties.mountDurationMs)
Pass gate: p95 <= 120ms
Stop gate: p95 > 250ms sustained
```

Until that's wired, the dev panel's amber-highlighted `mountDurationMs` cells on `MobileOverlayAckTab` serve as a local-dev signal when the phone runtime populates the field. Legacy phone binaries that predate the schema field simply don't emit it — backward-compatible by design (`mountDurationMs` is optional in the schema).

### Q6 — session-level divergence

**Motivation.** Detect sessions that ping-pong between pass/fail — these are usually the config-drift case (phone binary isn't v1-capable) that the ADR's pre-flip checklist is supposed to catch.

```
Events: onlook_overlay_push
Filter: properties.pipeline = 'overlay-v1'
Breakdown: properties.sessionId
Formula: count(distinct properties.ok)
Alert threshold: any session where both ok=true and ok=false occur in a 5-min window (count = 2)
```

## Go / no-go decision at T+7d

Pass if:
- Q1 v1 rate ≥ 98% absolute AND within 1% of legacy
- Q2 v1 p95 within 100ms of legacy
- Q3 v1 retry rate within 1% of legacy
- Q4 v1 soft-cap rate within 0.5% of legacy
- Q5 no single error kind sustained > 10/hour for more than 2 consecutive hours
- Q6 < 0.1% of sessions show ping-pong

If any single gate fails, revert the flag (one line in `two-tier.ts`) and investigate before re-arming.

## What to do if there's no data

The sink depends on `globalThis.posthog.capture` being defined. If queries return empty:

1. Confirm `NEXT_PUBLIC_POSTHOG_KEY` is set in the deployment env (see `apps/web/client/src/components/telemetry-provider.tsx`).
2. Spot-check in a browser console: with the editor open, run `globalThis.posthog?.capture?.name` — should return `"capture"`.
3. Check the mobile-preview flow actually fires — look for `[onlook.push-overlay]` lines in the browser console; the sink always logs as a side channel.
4. If step 3 produces console output but PostHog shows no events, the SDK hasn't initialized. Inspect `posthog.init` call-site in `telemetry-provider.tsx`.

## What NOT to rely on from this sink

- **Phone-side data.** Every event fires from the editor browser; the phone's ack stream is stored separately in `RelayWsClient.snapshot().acks` (not yet wired into any mounted dev-panel instance — MCG.16 scope).
- **Real-time alerts.** PostHog's event ingestion has a minute-plus latency. For faster signals, watch the browser devtools console directly or pipe to a server-side telemetry backend.
- **Per-tenant segmentation.** `sessionId` is not guaranteed stable across editor reloads; if we need per-project comparison, correlate via PostHog's own distinct_id and session recording (set up in `telemetry-provider.tsx::identify`).

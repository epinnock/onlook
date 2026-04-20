# ADR: Spectra inline iOS simulator in preview

Status: Accepted
Date: 2026-04-17
Branch: `feat/spectra-preview` (off `feat/mobile-client`)
Related Spectra branch: `feat/onlook-integration` in `/home/boxuser/ui-automator`

## Context

Onlook today has two disjoint preview surfaces:

1. **Web canvas frames** — `<iframe>`-based, with Penpal RPC for live editing.
   See `apps/web/client/src/app/project/[id]/_components/canvas/frame/*`.
2. **Preview on device** — produces an `onlook://` deep link QR code that is
   scanned by the Onlook Mobile Client (`apps/mobile-client`) or Expo Go.
   See `apps/web/client/src/hooks/use-preview-on-device.tsx`.

Neither surface lets the designer/developer see their mobile-client build
running *inside* Onlook. The ask is to embed a live iOS simulator stream in
the canvas so the build can be validated without another device.

Spectra (`/home/boxuser/ui-automator`) is an existing vision-based iOS testing
platform with a Fastify REST API, a WDA-backed simulator pool, and an MJPEG
screenshot stream already wired to its own dashboard — so we lean on it
rather than building a simulator pipeline from scratch.

## Decision

Add Spectra as a **second tab** in the existing `QrModal` titled **In browser**,
gated behind a `NEXT_PUBLIC_FEATURE_SPECTRA_PREVIEW` flag. Selecting the tab:

1. Reuses the existing `BuildOrchestrator` to produce a `bundleHash` and
   `onlookUrl` — identical to the "On device" path.
2. Calls a new `spectra` tRPC router that (a) provisions a simulator with the
   pre-uploaded OnlookMobileClient `.app` auto-installed and (b) pushes the
   `onlookUrl` via the simulator's URL-handler.
3. Spawns an **ephemeral** simulator frame on the canvas alongside the web
   frame, rendered via a new `SimulatorView` that streams a server-proxied
   MJPEG from Spectra and forwards pointer events as WDA tap/swipe calls.
4. Tears down the Spectra session on modal close, tab close, or five-minute
   idle — no DB persistence for simulator frames.

Scope for v1 is **iOS Simulator only.** AWS Device Farm and physical-iPhone
modes are supported by Spectra but not surfaced to Onlook users yet.

## Why supplement, not replace

- The QR flow is the authoritative distribution path (tested, on a real
  device, no dependency on Spectra's runner pool or network). Replacing it
  would regress reliability.
- Editing is web-only today — the simulator can't participate in the
  Penpal-RPC edit loop. Making it the default would remove the edit affordance
  from anyone who opens preview.
- The feature flag keeps Studio prod unaffected until the orchestration is
  proven out locally / in staging.

## Why server-mediated

- **No CORS handshake with Spectra.** The MJPEG stream, tap/swipe calls, and
  session lifecycle all pass through the Next.js server, so the browser never
  talks to Spectra directly and Spectra doesn't need to know about Onlook's
  origin.
- **No token exposure.** `SPECTRA_API_TOKEN` stays server-only — it is never
  bundled into client JS. The flag is the only client-visible Spectra-related
  env var, and it only toggles a UI affordance.
- **Auth ownership is ours.** The tRPC context already runs behind Supabase
  auth; all Spectra calls are `protectedProcedure`.

## Why ephemeral simulator frames

Simulator sessions are expensive (minutes to provision, MB to stream) and
don't survive a Spectra restart. Persisting a simulator frame to the DB would
create zombies on reload and no easy way to know the backing sim still exists.
In-memory frames map cleanly to "one session per open modal."

## Spectra-side prerequisites (shipped on `feat/onlook-integration`)

1. `POST /v1/devices/:id/open-url { url }` — pushes a deep link via WDA.
2. `POST /v1/devices` now accepts `installAppId` for auto-install on provision,
   plus a standalone `POST /v1/devices/:id/install-sim-app` route.
3. `GET /v1/devices/:id/mjpeg` — per-device stream routing so concurrent
   Onlook sessions don't cross-contaminate.

See the Spectra branch for diffs; the commit range is the acceptance surface
for this ADR.

## Open concerns

- **Single-sim contention.** Spectra's provisioner runs against one Scaleway
  Mac by default. Concurrent preview users queue on the provisioner; v1
  surfaces this in the UI as "Waiting for available simulator…". v2 needs a
  Spectra runner pool.
- **WDA latency.** 5 FPS + 100–300 ms tap roundtrip is fine for visual
  inspection, noticeably slow for tight interaction loops. The UI renders
  an optimistic pulse-ring on click to paper over the gap.
- **Production gating.** Turning the flag on in Studio prod requires a
  deployed Spectra with auth, a runner pool, and the OnlookMobileClient `.app`
  uploaded. Documented in `plans/spectra-inline-simulator-runbook.md`.

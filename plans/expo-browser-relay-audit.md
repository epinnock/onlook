# cf-expo-relay — Phase Q Audit (TQ0.1)

## Why this audit exists

Phase Q of `plans/expo-browser-e2e-task-queue.md` needs `cf-expo-relay` to
serve an Expo Go manifest that points at a **Hermes-bytecode bundle** produced
by Phase H (`cf-esm-builder`) and cached in R2 via `cf-esm-cache`. The parent
queue's Wave F (TF.6–TF.8) already scaffolded `apps/cf-expo-relay/`, but the
scaffold was shaped for the *browser-metro → WebSocket push → KV → Expo Go*
flow from `plans/expo-browser-implementation.md` §3.1, **not** for the
builder-hash-addressable flow that Phase Q requires.

Before Wave Q1 (TQ1.1–TQ1.4) starts, we need an honest inventory of what is
already in the worker tree, so agents don't re-build things that exist — or
worse, assume infra (Hono router, service binding to `cf-esm-cache`) that is
missing. This document is the output of TQ0.1 and mirrors the shape of
`plans/expo-browser-builder-audit.md` (TH0.1).

## Current-state inventory

All paths are relative to `apps/cf-expo-relay/` unless noted.

### Files present (entire worker tree)

- `README.md` (35 lines)
- `package.json` (14 lines)
- `tsconfig.json` (15 lines)
- `wrangler.jsonc` (31 lines)
- `src/worker.ts` (84 lines)
- `src/session.ts` (122 lines)

No `src/routes/`, no `src/lib/`, no `src/__tests__/`, no `Dockerfile`, no
`.dockerignore`, no `.dev.vars.example`, no `manifest-builder.ts`.

### Routes in `src/worker.ts`

- `src/worker.ts:32-48` — `parseSessionRoute(pathname)` splits on `/session/:id[/rest]`.
- `src/worker.ts:50-84` — default export `fetch` handler. Three branches:
  - **WS** `WS /session/:id` → `src/worker.ts:62-72`. Forwards to the
    `EXPO_SESSION` DO via `idFromName(sessionId)`, rewriting pathname to `/`.
    Returns 404 if subPath is not `/`.
  - **GET** `/session/:id/manifest` → `src/worker.ts:74-80`. Forwards as
    `/manifest` to the DO.
  - **GET** `/session/:id/bundle.js` → `src/worker.ts:74-80`. Forwards as
    `/bundle.js` to the DO.
  - Everything else → `Response('expo-relay: unknown route', { status: 404 })`.
- **No Hono router.** Routing is hand-rolled string splits. Note that TQ1.4's
  description in `expo-browser-e2e-task-queue.md:383` claims the task "wires
  the new manifest route into the **existing Hono router**" — the Hono router
  does not exist yet. `package.json:9-13` has zero runtime deps.
- **No `/manifest/:bundleHash`** top-level route (TQ1.2 target).
- **No `/health`** route (TQ0.3's `dev-relay.sh` contract requires one).

### Durable Object classes

- `ExpoSession` (defined `src/session.ts:39-122`)
  - Extends `DurableObject<Env>` from `cloudflare:workers`.
  - Constructor `src/session.ts:40-42` — passes through to super.
  - Methods:
    - `override async fetch(request)` — `src/session.ts:44-61`. Dispatches on
      upgrade header + pathname to `handleWebSocket`, `handleManifest`, or
      `handleBundle`. Returns 404 otherwise.
    - `private handleManifest(url)` — `src/session.ts:63-77`. Returns a
      **minimal stub manifest** with `{ name, slug, version, sdkVersion,
      bundleUrl }`. `bundleUrl` points at `${origin}/session/${sessionId}/bundle.js`.
      This is NOT a valid Expo Go manifest shape — it has no `launchAsset`, no
      `id`, no `createdAt`, no `runtimeVersion`, no `metadata`. See TQ0.2.
    - `private async handleBundle(_url)` — `src/session.ts:79-89`. Reads
      `bundle:${sessionId}` from the `BUNDLES` KV namespace, returns
      `application/javascript` or 404.
    - `private handleWebSocket()` — `src/session.ts:91-102`. Creates a
      `WebSocketPair`, `accept()`s the server side, registers a `message`
      handler. Returns 101 with the client side.
    - `private async onMessage(event)` — `src/session.ts:104-121`. Parses
      incoming JSON, validates via `isBundleMessage`, writes
      `bundle:${sessionId}` to KV with a **1h TTL** (`expirationTtl: 3600`).
  - No `alarm()`, no `blockConcurrencyWhile`, no hibernation API
    (`ctx.acceptWebSocket`), no R2 access.

### WebSocket handler

- Present (`src/session.ts:91-102`). Uses **classic** (non-hibernating)
  WebSocket API: `server.accept()` + event listener. This keeps the DO in
  memory as long as the socket is open.
- The Phase Q flow (TQ1.1–TQ1.4) does **not** use this WebSocket. Phase Q
  serves a hash-addressed manifest that the phone fetches over plain HTTP.
  Whether to keep the WebSocket for live-reload (Sprint 3 §3.3) or delete it
  is an open orchestrator question.

### Service bindings

- **None** in `cf-expo-relay/wrangler.jsonc`.
- Sister worker `cf-esm-cache/wrangler.jsonc:22-27` declares a `services`
  binding named `ESM_BUILDER` → service `esm-builder`. There is no reverse
  binding (`cf-esm-cache`) anywhere. TQ1.3 requires one so the relay can
  compute the correct public bundle URL.
- Sister worker `cf-esm-cache/src/worker.ts:20-23` exports
  `Env = { PACKAGES: R2Bucket; ESM_BUILDER: Fetcher }`. If/when the relay
  gains an `ESM_CACHE` service binding, the relay can either proxy directly
  or just read the cache's public hostname from a var.

### R2 / KV bindings

- KV: `BUNDLES` binding declared at `wrangler.jsonc:11-16` with a
  **placeholder id** `placeholder-bundles-kv-id`. `README.md:18-28` spells out
  that the namespace must be created manually via
  `wrangler kv:namespace create BUNDLES` before deploy. This binding is used
  by `ExpoSession.handleBundle` and `ExpoSession.onMessage` only.
- R2: **none**. The relay never touches R2 today. Phase Q does not strictly
  require R2 on the relay — the bundle lives in `cf-esm-cache`'s R2 bucket,
  and the relay only needs to know the public URL to put in the manifest's
  `launchAsset.url`.

### `wrangler.jsonc` content summary

`wrangler.jsonc` (31 lines):

- `name: "expo-relay"` — `wrangler.jsonc:3`
- `main: "src/worker.ts"` — `wrangler.jsonc:4`
- `compatibility_date: "2025-12-01"` — `wrangler.jsonc:5`
- `kv_namespaces[0] = { binding: "BUNDLES", id: "placeholder-bundles-kv-id" }`
  — `wrangler.jsonc:11-16`
- `durable_objects.bindings[0] = { name: "EXPO_SESSION", class_name: "ExpoSession" }`
  — `wrangler.jsonc:17-24`
- `migrations[0] = { tag: "v1", new_sqlite_classes: ["ExpoSession"] }` —
  `wrangler.jsonc:25-30`
- **No** `services` block. **No** `r2_buckets` block. **No** `vars` block.
  **No** `containers` block.

### Dockerfile

- None. Unlike `cf-esm-builder` which ships a Dockerfile for the
  `reactnative-esm` container, the relay is a pure Worker with a DO — no
  container runtime needed. Phase Q does not require adding one.

### Test coverage

- **Zero.** No `__tests__/`, no `*.test.ts`, no smoke scripts, no DO protocol
  test. `package.json:4-8` has only `typecheck`, `dev`, `deploy` scripts. No
  `test` script, no `bun:test` helper import.
- This matters: Wave F's TF.7 (`cf-expo-relay` Durable Object WebSocket
  session) had a validate row that required "unit test for the DO message
  protocol" (`expo-browser-task-queue.md:285`). That test was never written.

## Gap analysis (Phase Q Wave Q1 tasks vs current state)

| Task | What exists | What TQ needs to add |
|---|---|---|
| **TQ1.1** `src/manifest-builder.ts` + `__tests__/manifest-builder.test.ts` — builds Expo Go manifest from `bundleHash` + `assetMap` | Nothing under `manifest-builder`. `ExpoSession.handleManifest` (`src/session.ts:63-77`) emits an ad-hoc 5-field manifest that is **not** Expo Go compatible. | All new. Needs to match the shape locked in TQ0.2. Add `bun:test` glue in `package.json`. |
| **TQ1.2** `src/routes/manifest.ts` + `__tests__/routes/manifest.test.ts` — `GET /manifest/:bundleHash` | No `src/routes/` directory. No top-level manifest route (only `/session/:id/manifest` exists). | All new. Needs a routing layer (see TQ1.4). Requires the URL contract TQ1.3 locks (public hostname of `cf-esm-cache`). |
| **TQ1.3** `wrangler.jsonc` — service binding to `cf-esm-cache` | No `services` block. | Add `services[0] = { binding: "ESM_CACHE", service: "esm-cache" }`. The service name must match `cf-esm-cache/wrangler.jsonc:3` (`"name": "esm-cache"`). May also need a `vars.ESM_CACHE_PUBLIC_HOST` if the manifest URL needs a stable public domain rather than the internal service fetcher. |
| **TQ1.4** `src/worker.ts` — wire new manifest route into "the existing Hono router" | **No Hono router exists.** `src/worker.ts:50-84` is hand-rolled branching. `package.json:9-13` has zero runtime deps. | Either (a) pull `hono` into `package.json` as a runtime dep and refactor `worker.ts` to use it, or (b) extend the hand-rolled `parseSessionRoute`/branch style to add a `/manifest/:bundleHash` case. The task wording assumes Hono — the orchestrator must pick. |

**Bottom line:** Wave F delivered a Worker that serves the **old**
browser-metro WebSocket flow: push a bundle over WS → stash in KV → serve
`/session/:id/manifest` + `/session/:id/bundle.js`. Phase Q needs a **new,
hash-addressed** flow: `GET /manifest/:bundleHash` → return a real Expo Go
manifest whose `launchAsset.url` points at `cf-esm-cache`'s public `/bundle/:hash`.
Only the outer worker shell, the `BUNDLES` KV binding, and the DO migration
stub are reusable. `src/worker.ts` routing, `src/session.ts`'s `handleManifest`,
and the entire test/router infrastructure are new work.

## Open questions for the orchestrator

1. **Is the Hono router in TQ1.4's description a hard requirement, or can TQ
   stay hand-rolled?** `expo-browser-e2e-task-queue.md:383` says "wires the
   new manifest route into the **existing Hono router**" but no such router
   exists. `package.json:9-13` has zero runtime deps. Adding `hono` is a new
   runtime dep (same ask as TH2.6 raised in `plans/expo-browser-builder-audit.md`).
   Decide: add `hono` or extend the existing hand-rolled dispatch in
   `src/worker.ts:50-84`.
2. **Does `cf-esm-cache` need to be deployed first, or co-deployed, for TQ1.3's
   service binding to resolve?** Cloudflare service bindings require the
   target Worker to exist at deploy time (or resolve to a no-op 404 locally
   via `wrangler dev`). Wave F's merge gate was `wrangler deploy --dry-run`
   only — nothing has actually been deployed. Phase Q's Wave Q4 scenarios
   depend on both Workers running locally via `scripts/dev-relay.sh` +
   `scripts/dev-builder.sh`, which means local dev must work without a real
   deploy. Can `wrangler dev` cross-bind between two local workers?
3. **R2 bucket naming alignment.** Phase H's audit
   (`plans/expo-browser-builder-audit.md:148-157`) raises the same question:
   does `cf-esm-builder` write to `onlook-expo-packages` (the existing bucket
   used by `cf-esm-cache/wrangler.jsonc:16-21`) or a new bundle-specific
   bucket? Whichever the Phase H orchestrator picks becomes the public URL
   the relay's `launchAsset.url` must point at in TQ1.2. TQ1.1's
   `manifest-builder` signature depends on this.
4. **Delete or keep the WebSocket flow?** `src/session.ts:91-121` + all of
   `parseSessionRoute`'s WS branching in `src/worker.ts:62-72` exist for the
   old browser-metro → phone live-reload path. Phase Q's manifest flow does
   not use it. Sprint 3 §3.3 in `plans/expo-browser-implementation.md:653-656`
   wants hot reload "over the relay" via the WebSocket. Option A: delete the
   WS code now and re-add in a future sprint. Option B: keep it as dead code
   but do not extend. Option C: repurpose the WS to push `bundleHash` updates
   (not bundle bodies) to subscribed browser tabs so the QR modal can
   refresh. Pick one before TQ1.4 touches `worker.ts`.
5. **Does TQ1.1 need access to the `assetMap`?** The task says
   "builds an Expo Go manifest given a `bundleHash` and `assetMap` from
   cf-esm-builder". The `assetMap` shape is locked in TH0.3
   (`plans/expo-browser-bundle-artifact.md`) — TQ1.1 is implicitly blocked on
   TH0.3, not just TQ0.2. Add that dep edge explicitly.
6. **`BUNDLES` KV placeholder id.** `wrangler.jsonc:14` still has
   `placeholder-bundles-kv-id`. `wrangler deploy --dry-run` may tolerate it
   but a real deploy will fail. If the WebSocket flow is deleted (Q4 above),
   the entire `BUNDLES` binding can be removed. Otherwise, someone needs to
   create the namespace.
7. **TLS/LAN exposure for local dev.** `expo-browser-e2e-task-queue.md:568`
   flags that local `cf-expo-relay` needs to listen on `0.0.0.0` so a phone
   on the same LAN can fetch the manifest. TQ0.3's `scripts/dev-relay.sh`
   must handle this and surface the LAN IP. The audit cannot answer the
   question but flags that TQ0.3 is load-bearing for TH6.1's manual scan.

## Recommended task ordering

Given the gaps, the next implementation step is **not** TQ1.1 blind. The
sequencing that minimizes rework:

1. **TQ0.2** (Expo Go manifest format spec) — unblocks TQ1.1's return type and
   TQ1.2's route shape. The current `ExpoSession.handleManifest` stub at
   `src/session.ts:63-77` is a red herring — do not copy it.
2. **TQ0.3** (`scripts/dev-relay.sh`) — can run in parallel with TQ0.2 since
   it only needs the port (8787) and a `/health` endpoint contract. NOTE: the
   relay does not currently have a `/health` route; TQ0.3 must either add one
   as a one-line patch or the launcher must poll `/session/probe/manifest`
   (which today returns a stub manifest) as a readiness check.
3. **Orchestrator decision on Q4 (WebSocket fate) + Q1 (Hono vs hand-rolled)
   before any Wave Q1 task starts.** These two decisions change the file
   shapes of TQ1.1/TQ1.2/TQ1.4 materially.
4. **TQ1.3** (wrangler service binding) can land in parallel with TQ0.2 since
   it only touches `wrangler.jsonc` and has no code dep. Its validate
   (`wrangler deploy --dry-run`) works without TQ1.1–TQ1.2.
5. **TQ1.1** (`manifest-builder.ts` + test) — blocked on TQ0.2 locking the
   manifest shape and on TH0.3 locking `assetMap`. Add `bun:test` scripts to
   `package.json` as a side effect (no `test` script exists today).
6. **TQ1.2** (`routes/manifest.ts` + test) — blocked on TQ1.1 and on the Hono
   decision.
7. **TQ1.4** (wire route in `worker.ts`) — blocked on TQ1.2. If the
   orchestrator picks Hono, this task implicitly adds `hono` as a runtime dep
   and refactors the existing WS/HTTP dispatch block at `src/worker.ts:50-84`.
   Call that out explicitly so the task isn't scoped as "one-line route
   registration".

**Concrete first PR after Q0:** TQ1.3 (wrangler service binding) — zero code
risk, unblocks Wave Q1's merge gate dry-run. Hold TQ1.1+ until the Hono/WS
decisions are made.

# cf-esm-builder — Phase H Audit (TH0.1)

## Why this audit exists

Phase H of `plans/expo-browser-e2e-task-queue.md` needs a working Cloudflare
Container build pipeline that accepts Expo project source, runs Metro + Hermes
inside a Container, and serves a Hermes-bytecode bundle for Expo Go. The parent
task queue's Wave F (TF.1–TF.3) scaffolded `apps/cf-esm-builder/` but only
validated it with `wrangler deploy --dry-run`. Before Wave H1+ starts, we need
an honest inventory of what scaffolds actually exist so TH1.1–TH2.6 don't
re-build things that are already there (or worse, miss gaps).

This document is the output of TH0.1. Sister-worker context is noted inline
where it explains a binding choice.

## Current-state inventory

All paths are relative to `apps/cf-esm-builder/` unless noted.

### Files present (entire worker tree)

- `Dockerfile` (9 lines)
- `.dockerignore` (3 lines: `node_modules`, `dist`, `.git`)
- `package.json` (14 lines)
- `tsconfig.json` (15 lines)
- `wrangler.jsonc` (28 lines)
- `src/worker.ts` (46 lines) — only source file

No `src/routes/`, no `src/do/`, no `src/lib/`, no `container/`, no tests, no
`README.md`, no `.dev.vars.example`.

### Routes in `src/worker.ts`

- `src/worker.ts:40-46` — default export `fetch` handler. Ignores URL; routes
  everything to the singleton `ESM_BUILDER` DO via `idFromName('default')`.
- `src/worker.ts:28-37` — `EsmBuilder.fetch` ensures the Container is started
  and proxies every request to TCP port 5200 on the Container.
- **No HTTP route dispatch** — there is no `/pkg/`, no `/build`, no
  `/bundle/:hash`, no `/health`. Anything the Container does not handle on
  port 5200 falls through as 404 from the Container process, not from the
  Worker.

### Durable Object classes

- `EsmBuilder` (defined `src/worker.ts:21-38`)
  - Extends `DurableObject<Env>` from `cloudflare:workers`.
  - Single override: `async fetch(request): Promise<Response>`.
  - Behavior: if `this.ctx.container` exists and is not running, calls
    `ctx.container.start({ enableInternet: true })`, then forwards the request
    to `ctx.container.getTcpPort(5200).fetch(request)`. Returns 503 if port is
    unavailable.
  - **No** `alarm()`, no `blockConcurrencyWhile`, no KV/R2 access, no build
    session state. No method for building, tarring, hashing, or queuing.
  - `src/worker.ts:22-27` carries a comment acknowledging that the 2-minute
    `sleepAfter` idle-sleep is **not** actually wired because the low-level
    `ctx.container` API does not accept it; the author marked this for
    follow-up.

### Container binding (`wrangler.jsonc`)

- Present at `wrangler.jsonc:6-13`:
  - `class_name: "EsmBuilder"`
  - `image: "./Dockerfile"` (builds from the local Dockerfile)
  - `instance_type: "basic"`
  - `max_instances: 3`
- DO binding at `wrangler.jsonc:14-21` (`ESM_BUILDER` → `EsmBuilder`).
- Migration at `wrangler.jsonc:22-27`: `new_sqlite_classes: ["EsmBuilder"]`,
  tag `v1`.
- **No** `sleepAfter` field (matches the `worker.ts:22-27` comment).

### R2 bindings

- **None** in `cf-esm-builder/wrangler.jsonc`.
- Sister worker `cf-esm-cache/wrangler.jsonc:16-21` declares an R2 binding
  `PACKAGES` → bucket name `onlook-expo-packages`. The bucket must be created
  manually (`cf-esm-cache/README.md:21-29`).

### KV bindings

- **None** in `cf-esm-builder`.
- Sister worker `cf-expo-relay/wrangler.jsonc:11-16` declares a `BUNDLES` KV
  namespace with placeholder id `placeholder-bundles-kv-id`.

### Service bindings

- **None** in `cf-esm-builder`.
- Sister worker `cf-esm-cache/wrangler.jsonc:22-27` declares a `services`
  binding named `ESM_BUILDER` pointing at service `esm-builder`. That name
  matches `cf-esm-builder/wrangler.jsonc:3` (`"name": "esm-builder"`).

### Dockerfile contents

`Dockerfile` (all 9 lines):

- Base image: `node:20-slim`
- Installs the upstream `reactnative-esm` npm package globally (`npm install -g
  reactnative-esm`)
- Header comment cites upstream
  `https://github.com/RapidNative/reactnative-esm` (MIT) and claims the
  upstream validated a 6.7s cold start with a 251 MB image
- `EXPOSE 5200`
- `ENTRYPOINT ["reactnative-esm"]`

The container is an **npm-package-to-ESM builder**, not an Expo project
builder. It does not contain Expo CLI, Metro, Hermes, or anything that touches
a user project tree. It is shaped for Sprint 2 (self-hosted package CDN) from
`plans/expo-browser-implementation.md` §2.1, not Sprint 3 / Phase H.

### Test coverage

- **Zero.** No `__tests__/`, no `*.test.ts`, no smoke scripts. `package.json`
  has only `typecheck`, `dev`, `deploy` scripts.

## Gap analysis (Phase H tasks vs current state)

| Task | What exists | What TH needs to add |
|---|---|---|
| **TH1.1** Dockerfile (Node 20 + Expo CLI + Metro + Hermes) | `node:20-slim` base + `reactnative-esm`, no Expo/Metro/Hermes | Full rewrite: add Expo CLI, Metro, Hermes compiler, bundler deps. Current image is wrong tool for the job. |
| **TH1.2** `container/build.sh` + `extract-source.sh` + `run-metro.sh` | Nothing under `container/` | All new. Entrypoint today is `reactnative-esm` binary; needs to be a bash orchestrator over `expo export:embed` + `hermes`. |
| **TH1.3** Minimal Expo fixture (`container/__tests__/fixtures/minimal-expo/`) | No fixture, no `__tests__/` | All new. Parallel to TH1.2. |
| **TH1.4** `wrangler.jsonc` Container binding + `.dev.vars.example` | `containers` block already present at `wrangler.jsonc:6-13` (basic/3). No `.dev.vars.example`. | Verify image path still `./Dockerfile` after TH1.1, add `sleepAfter` if/when Container helper is swapped in, add `.dev.vars.example`. The binding itself is already wired. |
| **TH1.5** `container/README.md` | Missing | All new. |
| **TH2.0** Split `worker.ts` into `routes/`, `lib/`, `do/` | Single 46-line `worker.ts`, no subdirs | All new scaffold directories. `worker.ts` stays tiny but its imports change. |
| **TH2.1** `POST /build` route, R2 dedup, enqueue Container | No `/build` route. No R2 at all. No build-session state. | All new. Also needs `PACKAGES` (or similar) R2 binding added to `wrangler.jsonc`. |
| **TH2.2** `do/build-session.ts` — one Container per DO, stdio streaming | `EsmBuilder` DO exists but its only job is `port.fetch(request)` passthrough. No stdio, no session, no build state. | Either rewrite `EsmBuilder` or introduce a second DO. Per `worker.ts:22-27` TODO, idle-sleep is unresolved. |
| **TH2.3** `GET /bundle/:hash` from R2 | No route; no R2 binding. | All new. |
| **TH2.4** `GET /health` | No route. | All new. |
| **TH2.5** `lib/hash.ts` + `lib/r2.ts` | Nothing. | All new. |
| **TH2.6** Hono router wiring | `worker.ts` has zero routing and no Hono dependency (`package.json` devDeps only: `@cloudflare/workers-types`, `typescript`, `wrangler`). | All new. Requires adding `hono` as a runtime dep. |

**Bottom line:** Wave F delivered a Container-proxying Worker shell shaped for
a **package CDN** use case. Phase H needs a **project-bundle-builder**. Only
the outer binding shapes (DO registration, `containers` config block) are
reusable; the Dockerfile, DO body, and Worker routing all need to be
rewritten.

## Open questions for the orchestrator

1. **Does the team have a Cloudflare account with Containers enabled?** The
   current `wrangler.jsonc:6-13` already declares a `containers` block, but no
   one has run `wrangler deploy` against a real account. Before TH1.4 lands,
   confirm the CF account tier supports Containers or plan the CI-runner
   fallback called out in `expo-browser-e2e-task-queue.md:564`.
2. **Is Docker available on the orchestrator host?** `expo-browser-e2e-task-queue.md:554`
   dead-letters H1–H3 with reason `docker-required` if not. The current
   Dockerfile is trivial (`npm install -g reactnative-esm`); the TH1.1
   rewrite will pull Node, Android SDK bits (for Hermes), and Expo CLI — image
   size target is ≤ 800 MB. Pre-flight `docker info`.
3. **R2 bucket naming.** `cf-esm-cache/wrangler.jsonc:16-21` already uses
   `onlook-expo-packages`. Phase H wants the builder to *write* bundles and
   the cache to *read* them from the same bucket (TH1.4 + TH3.3 per
   `expo-browser-e2e-task-queue.md:567`). Should the builder reuse
   `onlook-expo-packages` or create a new bucket (e.g.
   `onlook-expo-bundles`)? The artifact format differs (package ESM vs Hermes
   bytecode) so separate buckets are probably cleaner, but that is a product
   call.
4. **Service-binding name collision.** `cf-esm-cache` binds a service named
   `ESM_BUILDER` → service `esm-builder` (the current worker name). Phase H
   may rename the worker or split it; TH3.3 must be kept in sync. Decide
   early.
5. **Idle-sleep TODO.** `src/worker.ts:22-27` explicitly flags that
   `sleepAfter` is not wired. TH2.2 should either migrate to
   `@cloudflare/containers`'s `Container` helper or add a manual
   `ctx.container?.destroy()` alarm. Which approach does the orchestrator
   prefer?
6. **Does TH2.6's "Hono router" mean pulling in the `hono` npm dep?** The
   current `package.json:9-13` lists zero runtime dependencies. If yes,
   `package.json` changes are implicit in TH2.6. Call it out explicitly.

## Recommended task ordering

Given the gaps above, the next implementation step is **NOT** TH1.1 blind. The
sequencing that minimizes rework is:

1. **TH0.2** (source-push protocol spec) — unblocks TH1.2's `build.sh`
   I/O shape and TH2.0's sub-module scaffold names.
2. **TH0.3** (bundle artifact format spec) — unblocks TH1.1 (what Hermes
   outputs the Dockerfile must produce) and TH1.2.
3. **TH0.4** (`scripts/dev-builder.sh`) — can run in parallel with TH0.2/TH0.3
   since it only needs a port number and a log path.
4. **TH1.3** (minimal Expo fixture) — no deps; the fixture is the same
   regardless of TH1.1's final image. Lands early so TH1.1 can use it as a
   smoke test.
5. **TH1.1** (Dockerfile rewrite) — blocked on TH0.3 (needs to know what
   artifacts the image is expected to produce).
6. **TH1.2** (`build.sh`) — blocked on TH1.1 + TH0.3.
7. **TH1.4** (wrangler Container binding verification + `.dev.vars.example`)
   — blocked on TH1.1. Mostly a verification pass since the `containers`
   block is already present; main change is `sleepAfter` + any new bindings
   (R2) that TH2.x adds.
8. **TH2.0** (worker sub-module scaffold) — blocked on TH0.2. Can start in
   parallel with TH1.x since it touches no Docker files.
9. **TH2.1–TH2.5** in parallel after TH2.0 (no cross-file conflicts).
10. **TH2.6** last to wire everything together.

**Concrete first PR after H0:** TH1.3 + TH2.0 in parallel — both are
low-risk, zero-dependency scaffolds that unblock the rest of the wave. Save
the Dockerfile rewrite for when TH0.3 has locked the artifact contract.

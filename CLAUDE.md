## Onlook Agents Guide

Actionable rules for repo agents—keep diffs minimal, safe, token‑efficient.

### Operating mode (READ FIRST — this is the most important rule)

**Do not stop until every task is finished.** When you have pending tasks, keep working. If you need a recommendation, pick what you believe is best and act on it — do not pause to ask. We are a keep-going company; this is our single most important operating rule, and it overrides any default "pause at a milestone for confirmation" instinct.

Practical implications:

- If the user has approved a direction and pending work flows from it, execute that work without re-asking for confirmation on mechanical follow-ons.
- When a design decision surfaces mid-task, make the call yourself and document the reasoning in an ADR under `plans/adr/` (template at `plans/adr/README.md`) or in the commit message. Do not block on it.
- "Task list empty" does not mean "session over." Check the relevant queue:
  - `plans/mobile-preview-shim-task-queue.md` — mobile-preview shim workstreams A–G
  - `plans/onlook-mobile-client-task-queue.md` — mobile-client (iOS custom Expo Go) work (create when scope is defined)
  - The repo's open plan docs under `plans/` for other areas
  Pull the next unblocked item.
- Only pause for genuinely destructive, hard-to-reverse actions (force-push to a shared branch, dropping a database, `rm -rf` on uncommitted work, sending messages to external systems, modifying CI secrets). Everything else: keep going.

### Parallel execution methodology

This repo targets up to **16 concurrent agents** executing independent tasks in parallel via git worktrees. The methodology below is adapted from the standard worktree + DAG scheduling pattern; specifics are Onlook-tuned.

**Worktrees are the isolation foundation.** Every parallel agent gets its own working tree under `.trees/<task-id>-<slug>/` sharing the main `.git` object store. Create via:

```bash
git worktree add -b ai/<task-id>-<slug> .trees/<task-id>-<slug> feat/<integration-branch>
cd .trees/<task-id>-<slug>
bun install
```

Branch prefix `ai/` enables bulk cleanup: `git branch --list 'ai/*' | xargs -n 1 git branch -D`.

**One task, one agent, one file (or small set).** Task granularity guidance:

- **Ideal:** single-file, single-function tasks with explicit acceptance criteria.
- **Acceptable:** 2–3 files within one well-defined module.
- **Risky:** 4+ files or crossing module boundaries — split instead.
- **Avoid:** monolithic tasks given to a single agent.

Never let two in-flight agents edit the same file. Hotspot files (registries, barrel exports, `package.json`, shared type files) must be assigned to exactly one agent, serialized ahead of fan-out waves, or auto-generated rather than hand-edited. Each task declares its allowed files in the queue doc; agents must stay within that list.

**Interface-first decomposition.** Define contracts (TypeScript interfaces, OpenAPI specs, schemas) in a sequential Wave 0, then fan out parallel implementation tasks against those contracts, then converge to a sequential integration/merge phase. This pattern drives the wave structure in the task queues.

**E2E tests are the validation gate.** Not human inspection. Every task has a `bun test <spec>` and/or `bunx playwright test <spec>` command as its acceptance criterion. CLAUDE.md's rule "Run `bun run typecheck` and tests — all must pass before claiming completion" applies per worktree. Agents self-correct on test failure (up to 3 retries reading the test output), then dead-letter the task for human review.

**Playwright specs live at** `apps/web/client/e2e/<feature>/`. Use the Onlook Editor via Chrome DevTools MCP for end-to-end UI flows when Playwright isn't sufficient.

**Port allocation for 16 slots.** To avoid dev-server collisions across worktrees, each slot gets a numeric offset added to base ports:

| Slot | Web (Next.js) | Mobile HTTP | Mobile WS |
|---|---|---|---|
| 0  | 3100 | 8787 | 8887 |
| 1  | 3101 | 8788 | 8888 |
| 2  | 3102 | 8789 | 8889 |
| 3  | 3103 | 8790 | 8890 |
| 4  | 3104 | 8791 | 8891 |
| 5  | 3105 | 8792 | 8892 |
| 6  | 3106 | 8793 | 8893 |
| 7  | 3107 | 8794 | 8894 |
| 8  | 3108 | 8795 | 8895 |
| 9  | 3109 | 8796 | 8896 |
| 10 | 3110 | 8797 | 8897 |
| 11 | 3111 | 8798 | 8898 |
| 12 | 3112 | 8799 | 8899 |
| 13 | 3113 | 8800 | 8900 |
| 14 | 3114 | 8801 | 8901 |
| 15 | 3115 | 8802 | 8902 |

Per worktree, export before running anything:

```bash
export PREVIEW_SLOT=<0-15>
export WEB_PORT=$((3100 + PREVIEW_SLOT))
export MOBILE_PREVIEW_PORT=$((8787 + PREVIEW_SLOT))
export MOBILE_PREVIEW_WS_PORT=$((8887 + PREVIEW_SLOT))
export PLAYWRIGHT_BASE_URL="http://127.0.0.1:${WEB_PORT}"
export NEXT_PUBLIC_MOBILE_PREVIEW_URL="http://127.0.0.1:${MOBILE_PREVIEW_PORT}"
```

**Integration branches, not main.** Agents merge to `feat/<area>` (e.g. `feat/mobile-preview-shim`), never directly to `main`. The integration branch has a stable E2E suite that runs on every merge; wave gates require full-suite green before fan-out to the next wave.

**DAG scheduling.** Tasks in a queue declare `Blocks on:` and `Blocks:`. An agent picks the highest-priority task whose `Blocks on:` list is all `done`. When a task completes, its dependents flip to `pending`. The queue doc's `Status log` table is the source of truth.

**Runtime isolation beyond git.** Worktrees isolate source code but share the OS. Risk points:
- Shared Supabase Postgres — don't drop or reset while others are testing. Coordinate schema changes via Wave 0 migration tasks.
- Shared Docker daemon for supabase containers.
- Shared `/tmp/cf-builds/` directory — use slot-prefixed subdirectories.
- Expo Go on a physical phone — one device, one active runtime. Device tests are serialized; automated E2E runs via Playwright without a phone.

**Full methodology detail:** `plans/parallel-execution-methodology.md` — branch model, cleanup commands, failure modes, shared-resource coordination table, wave pattern deep-dive.

### What is Onlook?

Onlook is an open-source, visual-first code editor ("Cursor for Designers"). It enables:
- Visual creation and editing of Next.js applications
- Direct DOM editing with AI assistance (Next.js + TailwindCSS)
- Instant deployment with shareable links
- Real-time collaborative editing

**License:** Apache 2.0

### Purpose & Scope

- Audience: automated coding agents working within this repository.
- Goal: small, correct diffs aligned with the project's architecture.
- Non-goals: editing generated artifacts, lockfiles, or `node_modules`.

### Repo Map

- Monorepo managed by Bun workspaces (see root `package.json`).
- App: `apps/web/client` (Next.js App Router + TailwindCSS).
- API routes: `apps/web/client/src/server/api/routers/*`, aggregated in
  `apps/web/client/src/server/api/root.ts`.
- Shared utilities: `packages/*` (e.g., `packages/utility`).

### Stack & Runtimes

- UI: Next.js App Router, TailwindCSS.
- API: tRPC + Zod (`apps/web/client/src/server/api/*`).
- Package manager: Bun only — use Bun for all installs and scripts; do not use
  npm, yarn, or pnpm.

### Agent Priorities

- Correctness first: minimal scope and targeted edits.
- Respect client/server boundaries in App Router.
- Prefer local patterns and existing abstractions; avoid one-off frameworks.
- Do not modify build outputs, generated files, or lockfiles.
- Use Bun for all scripts; do not introduce npm/yarn.
- Avoid running the local dev server in automation contexts (except inside a dedicated parallel-execution worktree with an assigned slot — see "Parallel execution methodology" above).
- Respect type safety.

### Next.js App Router

- Default to Server Components. Add `use client` when using events,
  state/effects, browser APIs, or client-only libs.
- App structure: `apps/web/client/src/app/**` (`page.tsx`, `layout.tsx`,
  `route.ts`).
- Client providers live behind a client boundary (e.g.,
  `apps/web/client/src/trpc/react.tsx`).
- Example roots: `apps/web/client/src/app/layout.tsx` (RSC shell, providers
  wired, scripts gated by env).
- Components using `mobx-react-lite`'s `observer` must be client components
  (include `use client`).

### tRPC API

- Routers live in `apps/web/client/src/server/api/routers/**` and must be
  exported from `apps/web/client/src/server/api/root.ts`.
- Use `publicProcedure`/`protectedProcedure` from
  `apps/web/client/src/server/api/trpc.ts`; validate inputs with Zod.
- Serialization handled by SuperJSON; return plain objects/arrays.
- Client usage via `apps/web/client/src/trpc/react.tsx` (React Query + tRPC
  links).

### Auth & Supabase

- Server-side client: `apps/web/client/src/utils/supabase/server.ts` (uses Next
  headers/cookies). Use in server components, actions, and routes.
- Browser client: `apps/web/client/src/utils/supabase/client/index.ts` for
  client components.
- Never pass server-only clients into client code.

### Env & Config

- Define/validate env vars in `apps/web/client/src/env.ts` via
  `@t3-oss/env-nextjs`.
- Expose browser vars with `NEXT_PUBLIC_*` and declare in the `client` schema.
- Prefer `env` from `@/env`. In server-only helpers (e.g., base URL in
  `src/trpc/helpers.ts`), read `process.env` only for deployment vars like
  `VERCEL_URL`/`PORT`. Never use `process.env` in client code; in shared
  modules, guard with `typeof window === 'undefined'`.
- Import `./src/env` in `apps/web/client/next.config.ts` to enforce validation.

### Imports & Paths

- Use path aliases: `@/*` and `~/*` map to `apps/web/client/src/*` (see
  `apps/web/client/tsconfig.json`).
- Do not import server-only modules into client components. Limited exception:
  editor modules that already use `path`; reuse only there. Never import
  `process` in client code.
- Split code by environment if needed (server file vs client file).

### MobX + React Stores

- Create store instances with `useState(() => new Store())` for stability across
  renders.
- Keep active store in `useRef`; clean up async with
  `setTimeout(() => storeRef.current?.clear(), 0)` to avoid route-change races.
- Avoid `useMemo` for store instances; React may drop memoized values leading to
  data loss.
- Avoid putting the store instance in effect deps if it loops; split concerns
  (e.g., project vs branch).
- `observer` components are client-only. Place one client boundary at the
  feature entry; child observers need not include `use client` (e.g.,
  `apps/web/client/src/app/project/[id]/_components/main.tsx`).
- Example store: `apps/web/client/src/components/store/editor/engine.ts:1` (uses
  `makeAutoObservable`).

### Styling & UI

- TailwindCSS-first styling; global styles are already imported in
  `apps/web/client/src/app/layout.tsx`.
- Prefer existing UI components from `@onlook/ui` and local patterns.
- Preserve dark theme defaults via `ThemeProvider` usage in layout.

### Internationalization

- `next-intl` is configured; provider lives in
  `apps/web/client/src/app/layout.tsx`.
- Strings live in `apps/web/client/messages/*`. Add/modify keys there; avoid
  hardcoded user-facing text.
- Keep keys stable; prefer additions over breaking renames.

### Common Pitfalls

- Missing `use client` where needed (events/browser APIs) causes unbound events;
  a single boundary at the feature root is sufficient.
- New tRPC routers not exported in `src/server/api/root.ts` (endpoints
  unreachable).
- Env vars not typed/exposed in `src/env.ts` cause runtime/edge failures. Prefer
  `env`; avoid new `process.env` reads in client code.
- Importing server-only code into client components (bundling/runtime errors).
  Note: `path` is already used in specific client code-editor modules; avoid
  expanding Node API usage beyond those areas.
- Bypassing i18n by hardcoding strings instead of using message files/hooks.
- Avoid `useMemo` to create MobX stores (risk of lost references); avoid
  synchronous cleanup on route change (race conditions).

### Two-tier overlay v2 / mobile-client architecture (Phase G, shipped 2026-04-22)

The pipeline that takes a component from the editor to the phone and updates it live. Photographic evidence in `plans/adr/assets/v2-pipeline/v2r-{hello,updated}.png`. Full ADR trail in `plans/adr/v2-pipeline-validation-findings.md` — read it if you're about to touch any of: `apps/mobile-client/`, `packages/mobile-preview/`, `apps/cf-expo-relay/`.

**OverlayHost pattern** — `apps/mobile-client/src/overlay/OverlayHost.tsx` lives as a sibling of `<AppRouter />` inside `App.tsx`'s root fragment. It subscribes to `globalThis._onlookOverlaySubscribers` and re-renders whenever `globalThis.renderApp(element)` is invoked by an eval'd overlay bundle. Do NOT try to use `AppRegistry.runApplication('OnlookOverlay', {rootTag: 1})` — it silently no-ops on bridgeless+new-arch and the old-arch fallback triggers `UIManager.createView` RedBoxes. Overlay rendering contract is documented in `plans/adr/overlay-host-architecture.md`.

**`globalThis.renderApp` is pinned** — `apps/mobile-client/index.js` installs it via `Object.defineProperty writable:false, configurable:false` so `packages/mobile-preview/runtime/runtime.js` cannot clobber it (ADR finding #3). The bridge filters trees containing raw native component strings (`RCTRawText`, `RCTText`, `RCTView`) before propagation (finding #4). Pure logic extracted at `apps/mobile-client/src/overlay/renderAppBridge.ts` for testability; `index.js` keeps an in-sync inline copy because Expo's `registerRootComponent` runs before the bundler processes TypeScript.

**Bridgeless iOS 18.6 gotchas (RN 0.81.6, newArchEnabled)** — these are unfixable at the app layer, use the documented workarounds:
- `fetch()` never dispatches response events to JS → use `globalThis.OnlookRuntime.httpGet(url, headers?)` (synchronous JSI → NSURLSession). Pattern in `apps/mobile-client/src/relay/manifestFetcher.ts:205` + `bundleFetcher.ts:55`.
- `WebSocket.onopen` / `onmessage` never dispatch to JS → replaced with a poll-based event channel. Primitive: `packages/mobile-preview/runtime/src/relayEventPoll.ts`. Mobile-client wrapper: `apps/mobile-client/src/relay/overlayAckPoll.ts`. Typed event union: `packages/mobile-client-protocol/src/relay-events.ts`. Wire contract: `plans/adr/cf-expo-relay-events-channel.md`.
- `UIManager.createView` absent in new-arch → `globalThis.__noOnlookRuntime = true` in `apps/mobile-client/index.js` gates `packages/mobile-preview/runtime/entry.js` from loading `runtime.js`.

**Mobile-client bundle split** — `packages/mobile-preview/runtime/entry-client-only.js` + `server/build-runtime-client-only.ts` produce `bundle-client-only.js` (~9 KB, shell.js only) vs `bundle.js` (~258 KB, full runtime). mobile-client's `scripts/bundle-runtime.ts` defaults to the slim bundle; Expo Go / mobile-preview harness keeps the full bundle via `--source=`. Build via `bun --filter @onlook/mobile-preview build:runtime:client-only`.

**cf-expo-relay local dev** — workerd's local mode blocks loopback fetches, so a plain HTTP server on `:8789` won't serve the `ESM_CACHE_URL` path. Run the fake cache as a sibling wrangler dev process so the service binding resolves inside workerd:
```bash
# Terminal A: cache stand-in (auto-synthesizes manifest-fields.json + bundle)
bunx wrangler dev --config apps/cf-expo-relay/scripts/wrangler-local-esm-cache.jsonc \
    --port 18789 --inspector-port 9331 --local

# Terminal B: real cf-expo-relay (service-binds to the cache above)
cd apps/cf-expo-relay && bunx wrangler dev --port 18788 --inspector-port 9330 --local

# One-shot verification
bash apps/cf-expo-relay/scripts/smoke-e2e.sh   # 7 steps: HTTP routes + 3 workerd-runtime WS smokes (AbiHello / overlay-push / asset-upload)
```

**Mobile-client test isolation** — `bun run test` in `apps/mobile-client` runs `scripts/run-tests-isolated.ts` which spawns each `*.test.ts` in its own process. `mock.module()` is process-wide in Bun and pollutes sibling files (`flow/__tests__/qrToMount.test.ts` mocks `deepLink/parse` + `relay/manifestFetcher` which other tests import for real). Do NOT use plain `bun test` across the mobile-client src tree — use `bun run test`. `.tsx` test files are NOT walked by the runner; keep tests as `.ts` and use `React.createElement` instead of JSX when needed.

### Context Discipline (for Agents)

- Search narrowly with ripgrep; open only files you need.
- Read small sections; avoid `node_modules`, `.next`, large assets.
- Propose minimal diffs aligned with existing conventions; avoid wide refactors.

### Notes

- Unit tests can be run with `bun test`
- Run type checking with `bun run typecheck`
- Apply database updates to local dev with `bun run db:push`
- Refrain from running the dev server
- DO NOT run `db:gen`. This is reserved for the maintainer.
- DO NOT use any type unless necessary

### Quick Commands Reference

```bash
# Development
bun install              # Install dependencies (ONLY use Bun)
bun run dev              # Start Next.js dev with Turbopack
bun run dev:client       # Client only
bun run dev:server       # Server only

# Quality
bun run lint             # Run ESLint
bun run format           # Fix formatting
bun run typecheck        # TypeScript check
bun run test             # Run tests

# Database
bun run db:push          # Push schema to local DB
bun run db:seed          # Seed database
bun run db:migrate       # Run migrations
bun run backend:start    # Start Supabase backend

# Docker
bun run docker:build     # Build Docker image
bun run docker:up        # Start containers
bun run docker:down      # Stop containers

# Build
bun run build            # Production build
bun run start            # Start production server
```

### Key Files Reference

| File | Purpose |
|------|---------|
| `package.json` | Monorepo root with Bun workspaces |
| `apps/web/client/package.json` | Main Next.js application |
| `apps/web/client/src/env.ts` | Environment variable schema |
| `apps/web/client/next.config.ts` | Next.js configuration |
| `apps/web/client/src/server/api/root.ts` | tRPC router aggregation |
| `apps/web/client/src/trpc/react.tsx` | tRPC React client |
| `apps/web/client/src/app/layout.tsx` | Root layout with providers |
| `apps/mobile-client/src/App.tsx` | Mobile-client root — `<AppRouter />` + `<OverlayHost />` siblings |
| `apps/mobile-client/index.js` | Expo entry — pins `globalThis.renderApp`, sets `__noOnlookRuntime=true`, exposes `React` + `ReactNative` to overlay `__require` |
| `apps/mobile-client/src/overlay/` | Subscribable renderApp + OverlayHost + bad-component filter + error boundary (Phase G) |
| `apps/mobile-client/src/relay/overlayAckPoll.ts` | httpGet-based wrapper over `startRelayEventPoll` |
| `apps/mobile-client/scripts/bundle-runtime.ts` | Copies slim `bundle-client-only.js` into iOS/Android assets at build time |
| `packages/mobile-preview/runtime/src/relayEventPoll.ts` | Poll primitive for the bridgeless event channel |
| `packages/mobile-preview/runtime/entry-client-only.js` | Slim mobile-client bundle entry (shell.js only) |
| `packages/mobile-client-protocol/src/relay-events.ts` | `RelayEventSchema` discriminated union + `parseRelayEvent` |
| `apps/cf-expo-relay/src/do/events-session.ts` | `EventsSession` DurableObject (ring buffer + cursor + keepAlive) |
| `apps/cf-expo-relay/src/routes/events.ts` | `/events` poll + `/events/push` worker routes |
| `apps/cf-expo-relay/scripts/smoke-e2e.sh` | 7-step full two-tier pipeline smoke against live wranglers (HTTP routes + AbiHello/overlay-push/asset-upload WS smokes) |
| `plans/adr/v2-pipeline-validation-findings.md` | 8 findings from simulator validation — read before touching the overlay pipeline |

### Resources

- Documentation: https://docs.onlook.com
- Contributing: https://docs.onlook.com/developers
- Architecture: https://docs.onlook.com/developers/architecture
- Discord: https://discord.gg/hERDfFZCsH

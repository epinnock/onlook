## Onlook Agents Guide

Actionable rules for repo agents—keep diffs minimal, safe, token‑efficient.

### Operating mode (READ FIRST — this is the most important rule)

**Do not stop until every task is finished.** When you have pending tasks, keep
working. If you need a recommendation, pick what you believe is best and act on
it — do not pause to ask. We are a keep-going company; this is our single most
important operating rule, and it overrides any default "pause at a milestone for
confirmation" instinct.

Practical implications:

- If the user has approved a direction and pending work flows from it, execute
  that work without re-asking for confirmation on mechanical follow-ons.
- When a design decision surfaces mid-task, make the call yourself and document
  the reasoning in an ADR under `plans/adr/` or in the commit message. Do not
  block on it.
- Task list empty does not mean "session over." Check the queue (`plans/onlook-mobile-client-task-queue.md`
  for mobile-client work; equivalent for other areas) and pull the next
  unblocked item.
- Only pause for genuinely destructive, hard-to-reverse actions (force-push to a
  shared branch, dropping a database, rm -rf on uncommitted work, sending
  messages to external systems, modifying CI secrets). Everything else: keep
  going.

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
- Avoid running the local dev server in automation contexts.
- Respect type safety and

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

### Resources

- Documentation: https://docs.onlook.com
- Contributing: https://docs.onlook.com/developers
- Architecture: https://docs.onlook.com/developers/architecture
- Discord: https://discord.gg/hERDfFZCsH

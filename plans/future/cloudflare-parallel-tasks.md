# Cloudflare Sandbox — Parallel Task Queue

> 24 tasks across 4 phases. Up to 8 agents via git worktrees. E2E test gates between phases.

## Execution Model

```
Phase 0  ──────────────────────────────────  1 agent, sequential
           │
Phase 1  ══╪══════════════════════════════  8 agents, parallel
           │
Phase 2  ══╪══════════════════════════════  6 agents, parallel
           │
Phase 3  ══╪══════════════════════════════  4 agents, parallel
           │
Phase 4  ──────────────────────────────────  1 agent, sequential (merge + e2e)
```

Each task = 1 worktree. No two tasks touch the same file.

---

## Phase 0: Contracts & Scaffolding (Sequential)

One agent defines all shared types, interfaces, and stubs that Phase 1 agents depend on.

### T0.1 — Define CF types, enum, and provider scaffold

**Worktree:** `ai/p0-contracts`
**Files owned:**
- `packages/code-provider/src/providers.ts` (add `Cloudflare = 'cloudflare'` to enum)
- `packages/code-provider/src/providers/cloudflare/types.ts` (NEW — CF-specific types)
- `packages/code-provider/src/providers/cloudflare/index.ts` (NEW — empty class stub extending Provider)
- `packages/code-provider/src/providers/cloudflare/utils/files.ts` (NEW — empty export)
- `packages/code-provider/src/providers/cloudflare/utils/terminal.ts` (NEW — empty export)
- `packages/code-provider/src/providers/cloudflare/utils/preview.ts` (NEW — empty export)

**Acceptance:**
- `bun run typecheck` passes
- All new files export their stubs
- Enum includes `Cloudflare`

**Details:**
```typescript
// types.ts should define:
export interface CloudflareProviderOptions {
  sandboxId?: string;
  apiToken?: string;
  accountId?: string;
  image?: string;
}

export interface CloudflareSandboxConfig {
  image: string;
  port: number;
  template: 'expo' | 'nextjs';
}
```

### T0.2 — Set up Playwright e2e infrastructure

**Worktree:** `ai/p0-e2e-infra`
**Files owned:**
- `apps/web/client/playwright.config.ts` (NEW)
- `apps/web/client/e2e/helpers/sandbox-fixtures.ts` (NEW — shared test fixtures)
- `apps/web/client/e2e/helpers/provider-mock.ts` (NEW — mock CF SDK for offline testing)
- `apps/web/client/e2e/smoke.spec.ts` (NEW — smoke test that infra works)
- `apps/web/client/package.json` (add `@playwright/test` devDep)

**Acceptance:**
- `bunx playwright test e2e/smoke.spec.ts` passes
- Fixture helpers export mock sandbox factory

---

## Phase 1: Independent Implementation (8 agents, parallel)

All Phase 1 tasks depend on T0.1 being merged. Each owns non-overlapping files.

### T1.1 — CF Provider: File operations utility

**Worktree:** `ai/p1-cf-file-ops`
**Files owned:**
- `packages/code-provider/src/providers/cloudflare/utils/files.ts`

**Scope:** Implement file operation wrappers around `@cloudflare/sandbox-sdk`:
- `readFile(sandbox, path)` → `sandbox.files.read()`
- `writeFile(sandbox, path, content)` → `sandbox.files.write()`
- `listFiles(sandbox, path)` → `sandbox.files.list()`
- `deleteFiles(sandbox, paths)` → `sandbox.files.remove()`
- `createDirectory(sandbox, path)` → `sandbox.files.mkdir()`
- `statFile(sandbox, path)` → stat via SDK
- `copyFiles(sandbox, src, dest)` → copy via SDK
- `downloadFiles(sandbox, paths)` → download via SDK

**Test:** Unit test in `packages/code-provider/src/providers/cloudflare/utils/__tests__/files.test.ts`
**Acceptance:** `bun test packages/code-provider/src/providers/cloudflare/utils/__tests__/files.test.ts` passes

---

### T1.2 — CF Provider: Terminal wrapper utility

**Worktree:** `ai/p1-cf-terminal`
**Files owned:**
- `packages/code-provider/src/providers/cloudflare/utils/terminal.ts`

**Scope:** Implement `CloudflareTerminal` extending `ProviderTerminal`, `CloudflareTask` extending `ProviderTask`, and `CloudflareBackgroundCommand` extending `ProviderBackgroundCommand`:
- `open()` → `sandbox.terminal.create()`
- `write(data)` → write to terminal WebSocket
- `run(command)` → `sandbox.commands.run()`
- `kill()` → kill terminal process
- `onOutput(cb)` → subscribe to terminal output stream

**Test:** Unit test in `packages/code-provider/src/providers/cloudflare/utils/__tests__/terminal.test.ts`
**Acceptance:** `bun test packages/code-provider/src/providers/cloudflare/utils/__tests__/terminal.test.ts` passes

---

### T1.3 — CF Provider: Preview URL utility

**Worktree:** `ai/p1-cf-preview`
**Files owned:**
- `packages/code-provider/src/providers/cloudflare/utils/preview.ts`

**Scope:** Preview URL generation and health checking for CF sandboxes:
- `getPreviewUrl(sandbox, port)` → `sandbox.getPreviewUrl(port)`
- `waitForPreview(url, timeoutMs)` → poll until 200 response
- `isPreviewReady(url)` → single check

**Test:** Unit test in `packages/code-provider/src/providers/cloudflare/utils/__tests__/preview.test.ts`
**Acceptance:** `bun test packages/code-provider/src/providers/cloudflare/utils/__tests__/preview.test.ts` passes

---

### T1.4 — CF Provider: File watcher utility

**Worktree:** `ai/p1-cf-filewatcher`
**Files owned:**
- `packages/code-provider/src/providers/cloudflare/utils/watcher.ts` (NEW)

**Scope:** Implement `CloudflareFileWatcher` extending `ProviderFileWatcher`:
- `start()` → `sandbox.files.watch()` and subscribe
- `stop()` → unsubscribe
- `registerEventCallback(cb)` → forward file change events

**Test:** Unit test in `packages/code-provider/src/providers/cloudflare/utils/__tests__/watcher.test.ts`
**Acceptance:** `bun test packages/code-provider/src/providers/cloudflare/utils/__tests__/watcher.test.ts` passes

---

### T1.5 — Database: Add providerType column to branches

**Worktree:** `ai/p1-db-provider-type`
**Files owned:**
- `packages/db/src/schema/project/branch.ts` (add `providerType` column)

**Scope:**
- Add `providerType: varchar('provider_type').default('code_sandbox')` to branches table
- Column is nullable with default `'code_sandbox'` for backward compat
- No migration file — per CLAUDE.md, use `bun run db:push` only

**Test:** `bun run typecheck` passes, schema is valid
**Acceptance:** `bun run typecheck` passes

---

### T1.6 — Environment: Add CF env vars

**Worktree:** `ai/p1-env-cf`
**Files owned:**
- `apps/web/client/src/env.ts` (add CF server vars)

**Scope:**
Add to `server` schema:
```typescript
CLOUDFLARE_SANDBOX_API_TOKEN: z.string().optional(),
CLOUDFLARE_ACCOUNT_ID: z.string().optional(),
NEXT_PUBLIC_ENABLED_PROVIDERS: z.string().optional().default('codesandbox'),
```
Add to `client` schema:
```typescript
NEXT_PUBLIC_ENABLED_PROVIDERS: z.string().optional(),
```

**Test:** `bun run typecheck` passes
**Acceptance:** `bun run typecheck` passes, env validation accepts missing CF vars

---

### T1.7 — Constants: Generalize sandbox URL helpers

**Worktree:** `ai/p1-sandbox-constants`
**Files owned:**
- `packages/constants/src/sandbox.ts` (NEW — provider-agnostic URL/template constants)

**Scope:**
```typescript
// New file — does NOT modify csb.ts
export const SANDBOX_TEMPLATES = {
  expo: { cfImage: 'scry-expo:latest', csbId: 'zx8g3k', port: 8080 },
  nextjs: { cfImage: 'scry-nextjs:latest', csbId: 'pt_EphPmsurimGCQdiB44wa7s', port: 3000 },
} as const;

export function getSandboxPreviewUrl(provider: string, sandboxId: string, port: number): string;
export const CF_DOMAIN = 'containers.cloudflare.com'; // verify actual domain
```
Also export from `packages/constants/src/index.ts` if barrel exists.

**Test:** Unit test in `packages/constants/src/__tests__/sandbox.test.ts`
**Acceptance:** `bun test packages/constants/src/__tests__/sandbox.test.ts` passes

---

### T1.8 — Container: Dockerfiles for CF images

**Worktree:** `ai/p1-dockerfiles`
**Files owned:**
- `docker/cloudflare/expo/Dockerfile` (NEW)
- `docker/cloudflare/nextjs/Dockerfile` (NEW)
- `docker/cloudflare/shared/onlook-preload-script.js` (NEW — copied from existing if available)
- `docker/cloudflare/build.sh` (NEW — build + push script)

**Scope:** Two Dockerfiles:
1. `scry-expo:latest` — Node 20 + Expo CLI + react-native-web
2. `scry-nextjs:latest` — Node 20 + Next.js

Both pre-install the Onlook preload script at `/opt/onlook/`.

**Test:** `docker build -f docker/cloudflare/expo/Dockerfile -t scry-expo:test .` succeeds
**Acceptance:** Both images build without error

---

## Phase 2: Assembly (6 agents, parallel)

Depends on Phase 1 merge. Combines utilities into integrated components.

### T2.1 — CF Provider: Main class implementation

**Worktree:** `ai/p2-cf-provider-main`
**Depends on:** T1.1, T1.2, T1.3, T1.4
**Files owned:**
- `packages/code-provider/src/providers/cloudflare/index.ts` (fill in stub from T0.1)

**Scope:** Full `CloudflareSandboxProvider extends Provider` using utils from Phase 1:
- Constructor takes `CloudflareProviderOptions`
- `initialize()` → create/connect to CF sandbox via SDK
- All abstract methods delegated to utils/files.ts, utils/terminal.ts, utils/preview.ts, utils/watcher.ts
- `createProject()` / `createProjectFromGit()` static methods
- `ping()` → `sandbox.status()`
- `destroy()` → `sandbox.stop()`
- `pauseProject()` / `stopProject()` / `listProjects()`

Mirror the CodesandboxProvider (560 lines) structure closely.

**Test:** Unit test mocking CF SDK
**Acceptance:** `bun run typecheck` passes, unit tests pass

---

### T2.2 — Factory: Wire CF provider into factory

**Worktree:** `ai/p2-factory-update`
**Depends on:** T2.1
**Files owned:**
- `packages/code-provider/src/index.ts`

**Scope:**
- Import `CloudflareSandboxProvider` and `CloudflareProviderOptions`
- Add `cloudflare?: CloudflareProviderOptions` to `ProviderInstanceOptions`
- Add Cloudflare case to `newProviderInstance()` and `getStaticCodeProvider()`
- Export `CloudflareSandboxProvider`

**Test:** `bun run typecheck` passes
**Acceptance:** `createCodeProviderClient(CodeProvider.Cloudflare, { providerOptions: { cloudflare: {...} } })` compiles

---

### T2.3 — tRPC: CF sandbox routes

**Worktree:** `ai/p2-trpc-cf-routes`
**Depends on:** T1.5, T1.6
**Files owned:**
- `apps/web/client/src/server/api/routers/project/cf-sandbox.ts` (NEW — separate file, avoids conflict with existing sandbox.ts)
- `apps/web/client/src/server/api/root.ts` (add cfSandbox router import)

**Scope:** New `cfSandboxRouter` with procedures:
- `create` — create CF sandbox with template selection (expo/nextjs)
- `start` — initialize session, return sandbox ID + preview URL
- `stop` — stop a CF sandbox
- `hibernate` — pause a CF sandbox

Use `protectedProcedure` with Zod input validation. Include retry logic (3 attempts, exponential backoff) matching existing sandbox.ts pattern.

**Test:** Type check + route registration test
**Acceptance:** `bun run typecheck` passes, new router is accessible via tRPC client types

---

### T2.4 — E2E: Provider operation tests

**Worktree:** `ai/p2-e2e-provider`
**Depends on:** T0.2, T2.1
**Files owned:**
- `apps/web/client/e2e/provider/cf-file-ops.spec.ts` (NEW)
- `apps/web/client/e2e/provider/cf-terminal.spec.ts` (NEW)
- `apps/web/client/e2e/provider/cf-preview.spec.ts` (NEW)

**Scope:** E2E tests using mocked CF SDK (from T0.2 fixtures):
- File read/write/list/delete round-trip
- Terminal create/write/output
- Preview URL generation and format validation

**Acceptance:** `bunx playwright test e2e/provider/` passes

---

### T2.5 — Feature flag: Provider toggle system

**Worktree:** `ai/p2-feature-flags`
**Depends on:** T1.6
**Files owned:**
- `apps/web/client/src/lib/feature-flags.ts` (NEW)

**Scope:**
```typescript
export function isProviderEnabled(provider: 'cloudflare' | 'codesandbox'): boolean {
  const enabled = env.NEXT_PUBLIC_ENABLED_PROVIDERS?.split(',') ?? ['codesandbox'];
  return enabled.includes(provider);
}
```

**Test:** Unit test with various env configurations
**Acceptance:** `bun test apps/web/client/src/lib/__tests__/feature-flags.test.ts` passes

---

### T2.6 — Install CF SDK dependency

**Worktree:** `ai/p2-cf-sdk-dep`
**Files owned:**
- `packages/code-provider/package.json` (add `@cloudflare/sandbox-sdk`)

**Scope:**
```bash
cd packages/code-provider && bun add @cloudflare/sandbox-sdk
```
Verify the package installs and types are available.

**Acceptance:** `bun install` succeeds, `import { Sandbox } from '@cloudflare/sandbox-sdk'` compiles

---

## Phase 3: Frontend & Session Integration (4 agents, parallel)

Depends on Phase 2 merge.

### T3.1 — Session manager: Route by provider type

**Worktree:** `ai/p3-session-routing`
**Depends on:** T2.1, T2.2
**Files owned:**
- `apps/web/client/src/components/store/editor/sandbox/session.ts`

**Scope:** Update `SessionManager.start()`:
- Accept `providerType` parameter (default: auto-detect)
- If `providerType === CodeProvider.Cloudflare`, use CF provider
- If local path detected, use NodeFs (existing)
- Otherwise fall back to CodeSandbox (existing)
- Update `createTerminalSessions()` if CF terminal API differs

**Test:** Unit test mocking provider creation
**Acceptance:** `bun run typecheck` passes

---

### T3.2 — Frontend: Provider selector in Create dropdown

**Worktree:** `ai/p3-provider-selector`
**Depends on:** T2.3, T2.5
**Files owned:**
- `apps/web/client/src/app/projects/_components/top-bar.tsx`

**Scope:** Update Create dropdown to show CF options when feature flag enabled:
```
Create ▾
├── Next.js (Cloud)           → CF Sandbox  [if cloudflare enabled]
├── Expo / RN (Cloud)         → CF Sandbox  [if cloudflare enabled]
├── Next.js (CodeSandbox)     → CSB
├── Expo / RN (CodeSandbox)   → CSB
├── Next.js (Local)           → NodeFs
├── Expo / RN (Local)         → NodeFs
└── Import Project
```

Wire CF options to `api.cfSandbox.create` mutation.

**Test:** E2E test in `apps/web/client/e2e/ui/create-project.spec.ts`
**Acceptance:** Dropdown renders CF options when flag is on, hidden when off

---

### T3.3 — Frontend: Preview URL handling

**Worktree:** `ai/p3-preview-urls`
**Depends on:** T1.7, T2.1
**Files owned:**
- Files that call `getSandboxPreviewUrl` (identify via grep, likely in preview/iframe components)

**Scope:** Update preview URL resolution to check provider type:
- If Cloudflare → use CF SDK's `getPreviewUrl(port)`
- If CodeSandbox → use existing `https://{id}-{port}.csb.app` pattern
- Import from new `packages/constants/src/sandbox.ts`

**Test:** Unit test for URL generation per provider
**Acceptance:** `bun run typecheck` passes, URLs correct for both providers

---

### T3.4 — E2E: Full sandbox creation flow

**Worktree:** `ai/p3-e2e-create-flow`
**Depends on:** T2.3, T2.4, T3.2
**Files owned:**
- `apps/web/client/e2e/flows/create-cf-sandbox.spec.ts` (NEW)
- `apps/web/client/e2e/flows/create-csb-sandbox.spec.ts` (NEW — regression)

**Scope:**
1. Navigate to projects page
2. Click Create → CF Expo option
3. Assert sandbox creation tRPC call fires
4. Assert preview URL loads
5. Assert file operations work (create, read, modify)
6. Assert terminal opens and responds
7. Regression: existing CSB flow still works

**Acceptance:** `bunx playwright test e2e/flows/` passes

---

## Phase 4: Integration Merge & Validation (Sequential)

### T4.1 — Merge all worktrees + full e2e suite

**Worktree:** main branch
**Depends on:** All Phase 3 tasks

**Scope:**
1. Merge worktrees in dependency order: P0 → P1 → P2 → P3
2. Resolve any merge conflicts (should be none if file ownership was respected)
3. Run full validation:
   ```bash
   bun run typecheck
   bun run lint
   bun test
   bunx playwright test
   ```
4. Verify CSB regression (existing flows still work)

**Acceptance:** All checks green

---

### T4.2 — Migration defaults: CF for new, CSB fallback for existing

**Worktree:** `ai/p4-migration-defaults`
**Depends on:** T4.1
**Files owned:**
- Wherever default provider is set for new projects

**Scope:**
- New projects default to `CodeProvider.Cloudflare` when CF env vars present
- Existing projects keep `CodeProvider.CodeSandbox`
- `NEXT_PUBLIC_ENABLED_PROVIDERS=cloudflare,codesandbox` enables both

**Acceptance:** E2E test: new project → CF, existing project → CSB

---

## Dependency Graph (DAG)

```
T0.1 ─────┬──→ T1.1 ──┐
           ├──→ T1.2 ──┤
           ├──→ T1.3 ──├──→ T2.1 ──→ T2.2 ──→ T3.1
           ├──→ T1.4 ──┘              │         │
           ├──→ T1.5 ──→ T2.3 ───────┼──→ T3.2 ├──→ T4.1 ──→ T4.2
           ├──→ T1.6 ──→ T2.5 ───────┘    │    │
           ├──→ T1.7 ─────────────────→ T3.3    │
           └──→ T1.8                        │    │
                                            └────┘
T0.2 ──────────→ T2.4 ──→ T3.4 ──→ T4.1

T1.8 (Dockerfiles) — no downstream deps, can merge anytime

T2.6 (SDK dep) — should merge early in Phase 2, T2.1 needs it
```

## Worktree Commands

```bash
# Phase 0
git worktree add -b ai/p0-contracts .trees/p0-contracts main
git worktree add -b ai/p0-e2e-infra .trees/p0-e2e-infra main

# Phase 1 (run after P0 merge)
git worktree add -b ai/p1-cf-file-ops .trees/p1-cf-file-ops main
git worktree add -b ai/p1-cf-terminal .trees/p1-cf-terminal main
git worktree add -b ai/p1-cf-preview .trees/p1-cf-preview main
git worktree add -b ai/p1-cf-filewatcher .trees/p1-cf-filewatcher main
git worktree add -b ai/p1-db-provider-type .trees/p1-db-provider-type main
git worktree add -b ai/p1-env-cf .trees/p1-env-cf main
git worktree add -b ai/p1-sandbox-constants .trees/p1-sandbox-constants main
git worktree add -b ai/p1-dockerfiles .trees/p1-dockerfiles main

# Phase 2 (run after P1 merge)
git worktree add -b ai/p2-cf-provider-main .trees/p2-cf-provider-main main
git worktree add -b ai/p2-factory-update .trees/p2-factory-update main
git worktree add -b ai/p2-trpc-cf-routes .trees/p2-trpc-cf-routes main
git worktree add -b ai/p2-e2e-provider .trees/p2-e2e-provider main
git worktree add -b ai/p2-feature-flags .trees/p2-feature-flags main
git worktree add -b ai/p2-cf-sdk-dep .trees/p2-cf-sdk-dep main

# Phase 3 (run after P2 merge)
git worktree add -b ai/p3-session-routing .trees/p3-session-routing main
git worktree add -b ai/p3-provider-selector .trees/p3-provider-selector main
git worktree add -b ai/p3-preview-urls .trees/p3-preview-urls main
git worktree add -b ai/p3-e2e-create-flow .trees/p3-e2e-create-flow main

# Cleanup all
git branch --list 'ai/*' | xargs -n 1 git branch -d
```

## Retry Policy

Each agent task follows:
1. Implement code
2. Run acceptance test
3. If fail → read error output, fix, re-run (max 3 retries)
4. If still failing after 3 retries → mark as blocked, log error for human review
5. On success → commit to worktree branch, mark complete

## Concurrency Schedule

| Phase | Agents | Wall time estimate |
|-------|--------|--------------------|
| P0    | 2      | ~30 min            |
| P1    | 8      | ~45 min            |
| P2    | 6      | ~1 hr              |
| P3    | 4      | ~1 hr              |
| P4    | 1      | ~30 min            |
| **Total** | **—** | **~3.5 hrs** (vs ~5-6 weeks sequential) |

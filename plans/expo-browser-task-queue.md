# Expo browser provider — parallel task queue

**Source plan:** `plans/expo-browser-implementation.md` is the canonical "what and why." This file is the "how to dispatch it to 8 parallel agents." Every task here references a section in the source plan.

**Goal:** A long queue of small, file-scoped tasks that can be pulled by up to 8 parallel agents working in isolated git worktrees, each gated by an E2E or unit test that produces unambiguous pass/fail.

**Decomposition principles** (from the research the user shared):
- One file, one owner — no two tasks in the same wave modify the same file
- Single-file or 2–3-file tasks only; nothing crosses module boundaries
- Each task has explicit acceptance criteria (a test command that returns 0 or non-0)
- Interface-first: Phase 0 lands all shared types/interfaces sequentially, then Phase 1+ runs in parallel
- Hotspot files (`session.ts`, `index.ts`, `csb.ts`) get a single owner, never two
- Failure retry: 3 attempts with test output fed back as context, then dead-letter for human review

---

## Conventions

### Worktree layout

```
.trees/                                   ← gitignored, in repo root
├── ai-p0-foundation/                     ← Phase 0 worktrees
├── ai-p1-csb-capabilities/               ← Phase 1+ worktrees
├── ai-p1-cf-capabilities/
├── ai-p1-nodefs-capabilities/
├── ai-p1-expo-stub/
├── ...
```

### Worktree creation

```bash
git worktree add -b ai/<task-id>-<slug> .trees/<task-id>-<slug> main
# example
git worktree add -b ai/T0.1-branch-cleanup .trees/T0.1-branch-cleanup main
```

### Branch naming

- Pattern: `ai/<task-id>-<short-slug>` (e.g. `ai/T1.4-glob-dispatch`)
- The `ai/` prefix enables bulk cleanup: `git branch --list 'ai/*' | xargs -n 1 git branch -d`

### Per-worktree dependency install

`pnpm`/`bun` global content-addressable store keeps this fast. After `git worktree add`, run `bun install` inside the worktree. **Do not symlink** `node_modules` between worktrees — install per worktree.

### Per-worktree scope guard

Drop a `.claude/rules.md` into each worktree before the agent starts:

```markdown
# Task scope for <task-id>

Work ONLY on the files listed below. Do NOT modify any other file in the repo.
If you find you need to touch a file outside this list, STOP and report — that's
a sign the task needs to be split or escalated.

Files:
- <file-1>
- <file-2>
```

### Validation gate

Every task has a `validate` command. Tasks pass when `validate` exits 0. Agents have **3 retry attempts** with test output as feedback before dead-lettering.

```bash
# Default validate for a task
cd .trees/<task-id>-<slug>
bun run typecheck && bun run lint && bun test <test-path> && bun run e2e:<test-name>
```

### Merge strategy

After validation passes, the orchestrator merges to `feat/expo-browser-provider` (the long-running integration branch from the implementation plan), not `main`. Merges follow the dependency order — never out of order.

```bash
git checkout feat/expo-browser-provider
git merge --no-ff ai/<task-id>-<slug>
bun run typecheck && bun test           # integration check
git worktree remove .trees/<task-id>-<slug>
git branch -d ai/<task-id>-<slug>
```

If integration fails after a merge, **revert that merge**, dead-letter the task for human review, and continue with the next task.

### Concurrency cap

Hard cap of **8 concurrent agents**. Some waves below have more than 8 tasks — the orchestrator dispatches the first 8 from the wave's pending pool, and pulls the next task as soon as one finishes. Tasks within a wave have no inter-dependencies, so order doesn't matter.

### E2E test infrastructure

Reference the existing test paths in the repo:
- Unit tests: `bun test <pkg>/...` (Bun built-in)
- E2E tests: this plan assumes a Playwright-style E2E suite at `apps/web/client/e2e/`. **Wave E** below adds the missing E2E specs as their own tasks. Tasks in earlier waves that reference an E2E spec assume Wave E has already landed the spec OR provide a unit-test fallback.

---

## Wave structure (the full DAG, top-down)

```
Wave 0 — Foundation (SEQUENTIAL, single agent)
  6 tasks. Lands the shared interfaces every later wave depends on.
  Cannot start Wave 1 until ALL of Wave 0 is merged.
  Estimated wall time: 2–4 hours (sequential).
        │
        ▼
Wave A — Provider implementations (PARALLEL up to 8)
  9 tasks. Each provider implements getCapabilities(); ExpoBrowser stub
  + Supabase Storage adapter + BrowserTask + interceptor + tests.
  Estimated wall time: 1–2 hours (parallel).
        │
        ├─────────────────────────────────────────────────────────┐
        ▼                                                         ▼
Wave B — Tool refactors (PARALLEL up to 8)            Wave C — Browser-metro extraction (PARALLEL up to 4)
  6 tasks. Each tool's per-call dispatch +              5 tasks. Worker, runtime, host, broadcast, tests.
  per-tool unit test. System prompt append.             Independent of Wave A/B.
  Estimated: 1–2 hours.                                 Estimated: 2–3 hours (per worktree).
        │                                                         │
        ▼                                                         ▼
Wave D — Sandbox/session integration (SEMI-SERIAL)    Wave F — CF Worker apps (PARALLEL up to 8)
  4 tasks. session.ts, sandbox/index.ts, git.ts.        9 tasks. esm-builder + esm-cache + expo-relay
  These are hotspot files — sequential within wave.    + warm script. Independent of everything else
  Estimated: 1 hour.                                    above. Can start at the same time as Wave A.
        │                                                         │
        ▼                                                         │
Wave E — E2E spec scaffolding (PARALLEL up to 8)                  │
  10 tasks. Playwright specs for every Wave A–D                   │
  acceptance criterion. Land BEFORE merging Wave A–D              │
  if any task references e2e:<name>.                              │
        │                                                         │
        ▼                                                         │
Wave G — Position B migration (PARALLEL up to 8)                  │
  10 tasks. getSandboxPreviewUrl call sites + hibernate           │
  gating + publish UI disclaimer. Each call site is its           │
  own task. Independent of Wave A–F.                              │
        │                                                         │
        ▼                                                         │
Wave H — Preview pipeline integration (PARTIALLY PARALLEL)        │
  6 tasks. Service worker, HTML shell, SW register,               │
  frame URL routing, preload-script captureScreenshot.            │
        │                                                         │
        ▼                                                         │
Wave I — Settings UI + user flag (PARALLEL up to 4)               │
  4 tasks. tRPC procedure, hook, modal radio, admin route.        │
        │                                                         │
        └─────────────────────────────────────────────────────────┤
                                                                  ▼
                                              Wave J — End-to-end smoke (SERIAL)
                                                3 tasks. Full Sprint 0 + Sprint 1 DoDs
                                                run as single E2E specs against the
                                                merged feat/expo-browser-provider branch.
```

**Total task count: ~62 tasks**. With Wave 0's 6 sequential tasks plus all other waves running in parallel where possible, the queue should drain in roughly 12–20 wall-clock hours of agent time.

---

## Wave 0 — Foundation (SEQUENTIAL, 1 agent)

These tasks ship the interfaces that everything else binds to. **Run them in order. Do not start Wave A until all of Wave 0 is merged.**

| ID | Title | Files | Validate | Source |
|---|---|---|---|---|
| **T0.1** | Branch + cleanup | (creates branch `feat/expo-browser-provider` from `main`; deletes `packages/code-provider/src/providers/snack/` directory) | `[ ! -d packages/code-provider/src/providers/snack ] && bun run typecheck` | §0.1 |
| **T0.2** | Add `CodeProvider.ExpoBrowser` enum + wire registry | `packages/code-provider/src/providers.ts`, `packages/code-provider/src/index.ts` | `bun run typecheck && bun test packages/code-provider` | §0.2 |
| **T0.3** | Add `getCapabilities()` to Provider abstract class | `packages/code-provider/src/types.ts` (add abstract method + `ProviderCapabilities` type) | `bun run typecheck` (every existing provider becomes a TS error until T0.4-T0.7 land — that's expected; orchestrator merges T0.3 anyway and the next 4 tasks fix it) | §0.3 + §0.4 |
| **T0.4** | DB migration: `branches.providerType` column | `packages/db/src/schema/project/branch.ts`, `packages/db/src/mappers/project/branch.ts`, `packages/db/src/defaults/branch.ts` | `bun run db:push` (local), `bun run typecheck`, snapshot test of branch row mapping | §0.5 |
| **T0.5** | Expose `providerType` in `Branch` model | `packages/models/src/project/branch.ts` | `bun run typecheck` | §0.5 |
| **T0.6** | DB schema: `users.featureFlags jsonb` | `packages/db/src/schema/auth/user.ts`, `packages/db/src/mappers/user.ts` (if exists) | `bun run db:push`, `bun run typecheck` | §0.5 |
| **T0.7** | `getSandboxPreviewUrl` interface change (NOT call sites) | `packages/constants/src/csb.ts` only — change signature to `getSandboxPreviewUrl(provider: CodeProvider, sandboxId: string, port: number)`, internal switch on provider, default branch returns existing CSB URL. Old `'code_sandbox'` literal still resolves. **Do NOT touch call sites in this task** | `bun run typecheck` (every call site breaks until Wave G; that's expected) | §0.9 |

**Wave 0 merge gate:** all 7 tasks merged to `feat/expo-browser-provider`. After merge, `bun run typecheck` is allowed to fail at the call sites of `getSandboxPreviewUrl` — Wave G fixes them. Everything else must typecheck clean.

---

## Wave A — Provider implementations (PARALLEL, up to 8 concurrent)

Each task creates or modifies one file. Independent. Dispatch in any order.

| ID | Title | Files | Validate |
|---|---|---|---|
| **TA.1** | CSB provider implements `getCapabilities()` | `packages/code-provider/src/providers/codesandbox/index.ts` | `bun test packages/code-provider/src/providers/codesandbox` |
| **TA.2** | Cloudflare provider implements `getCapabilities()` | `packages/code-provider/src/providers/cloudflare/index.ts` | `bun test packages/code-provider/src/providers/cloudflare` |
| **TA.3** | NodeFs provider implements `getCapabilities()` | `packages/code-provider/src/providers/nodefs/index.ts` | `bun test packages/code-provider/src/providers/nodefs` |
| **TA.4** | ExpoBrowser provider scaffold (class + types only) | `packages/code-provider/src/providers/expo-browser/index.ts`, `packages/code-provider/src/providers/expo-browser/types.ts` — empty class extending Provider, all methods stub-throw, `getCapabilities()` returns `{ supportsTerminal: false, supportsShell: false, supportsBackgroundCommands: false, supportsHibernate: false, supportsRemoteScreenshot: false }` | `bun run typecheck && bun test packages/code-provider/src/providers/expo-browser/__tests__/scaffold.test.ts` |
| **TA.5** | ExpoBrowser Supabase Storage adapter | `packages/code-provider/src/providers/expo-browser/utils/storage.ts` (read/write/list/stat/delete/rename/copy + watch via Supabase Realtime) | `bun test packages/code-provider/src/providers/expo-browser/__tests__/storage.test.ts` (uses a fake Supabase client) |
| **TA.6** | ExpoBrowser `BrowserTask` for dev/start | `packages/code-provider/src/providers/expo-browser/utils/browser-task.ts` (real `ProviderTask` implementation: `open()` returns banner, `restart()` triggers `bundler.bundle()`, `onOutput` pipes events) | `bun test packages/code-provider/src/providers/expo-browser/__tests__/browser-task.test.ts` |
| **TA.7** | ExpoBrowser narrow interceptor (Layer C) | `packages/code-provider/src/providers/expo-browser/utils/run-command.ts` (~80 LOC, regex + switch over install/uninstall/dev/build patterns; everything else returns `PROVIDER_NO_SHELL`) | `bun test packages/code-provider/src/providers/expo-browser/__tests__/run-command.test.ts` (one test per pattern + one test for the fall-through error) |
| **TA.8** | ExpoBrowser provider wires storage + task + interceptor | Edits ONLY `packages/code-provider/src/providers/expo-browser/index.ts` (the scaffold from TA.4) — replaces stub-throws with real calls to TA.5/TA.6/TA.7. **Owns the file alone.** Depends on TA.4, TA.5, TA.6, TA.7. | `bun test packages/code-provider/src/providers/expo-browser` (full provider test suite) |
| **TA.9** | Provider registry routing | `packages/code-provider/src/index.ts` — adds `expo_browser` branch in `newProviderInstance` and `getStaticCodeProvider`. **Owns the file alone in this wave** (T0.2 already touched it but is merged). | `bun run typecheck && bun test packages/code-provider` |

**Wave A merge gate:** `bun test packages/code-provider` passes cleanly. Provider registry now resolves `CodeProvider.ExpoBrowser` to a working instance.

---

## Wave B — Chat-tool refactors (PARALLEL, up to 6 concurrent)

Each tool gets a per-call branch-local dispatch using `provider.getCapabilities()`. Each task touches exactly one tool file. Six tasks, six files, no conflicts.

| ID | Title | Files | Validate |
|---|---|---|---|
| **TB.1** | `glob.ts` in-process dispatch | `packages/ai/src/tools/classes/glob.ts` — adds `tryInProcessGlob` branch using `getFileSystem(branchId, editorEngine)` from `packages/ai/src/tools/shared/helpers/files.ts:5` + `picomatch`. CSB path unchanged. Adds `picomatch` to `packages/ai/package.json` if not transitive. | `bun test packages/ai/src/tools/classes/__tests__/glob.test.ts` (tests both shell path with mock and in-process path with in-memory CodeFileSystem) |
| **TB.2** | `grep.ts` in-process dispatch | `packages/ai/src/tools/classes/grep.ts` — same shape as TB.1, JS-side regex over `CodeFileSystem` files | `bun test packages/ai/src/tools/classes/__tests__/grep.test.ts` |
| **TB.3** | `typecheck.ts` in-process dispatch with `@typescript/vfs` | `packages/ai/src/tools/classes/typecheck.ts`, `packages/ai/package.json` (add `@typescript/vfs`) | `bun test packages/ai/src/tools/classes/__tests__/typecheck.test.ts` (includes the perf measurement gate from §1.7.6 — task fails the test and prints the perf number if exceeded) |
| **TB.4** | `bash-read.ts` capability check | `packages/ai/src/tools/classes/bash-read.ts` — 4-line block at top of `handle()` that returns `PROVIDER_NO_SHELL` when `provider.getCapabilities().supportsShell === false` | `bun test packages/ai/src/tools/classes/__tests__/bash-read.test.ts` |
| **TB.5** | `bash-edit.ts` capability check | `packages/ai/src/tools/classes/bash-edit.ts` | `bun test packages/ai/src/tools/classes/__tests__/bash-edit.test.ts` |
| **TB.6** | System prompt append | `packages/ai/src/prompt/constants/system.ts` — append the branch-conditional language block from §0.7. Snapshot test asserts the new lines appear in `SYSTEM_PROMPT`. | `bun test packages/ai/src/prompt/__tests__/system.test.ts` |

**Wave B merge gate:** `bun test packages/ai` passes. Existing tests (run with default CSB-mock) still pass; new tests for in-process paths pass.

---

## Wave C — Browser-metro extraction (PARALLEL, up to 4 concurrent)

A new workspace package. All tasks land files inside `packages/browser-metro/`. The package doesn't exist yet, so **TC.1 must run first** (it scaffolds `package.json` and `tsconfig.json`); TC.2–TC.5 can then run in parallel.

| ID | Title | Files | Depends | Validate |
|---|---|---|---|---|
| **TC.1** | Package scaffold | `packages/browser-metro/package.json`, `packages/browser-metro/tsconfig.json`, `packages/browser-metro/src/index.ts` (empty exports), workspace registration if needed | — | `bun install && bun run typecheck` |
| **TC.2** | Vendor Web Worker bundler from reactnative.run (MIT) | `packages/browser-metro/src/worker/index.ts`, `packages/browser-metro/src/worker/sucrase.ts`, `packages/browser-metro/src/worker/resolver.ts`, `packages/browser-metro/src/worker/dependency-graph.ts` (extracted from upstream, RapidNative branding stripped, MIT attribution preserved in `LICENSE.NOTICE`) | TC.1 | `bun test packages/browser-metro/src/worker/__tests__/` (smoke test: bundle a hello-world RN component, assert output contains expected modules) |
| **TC.3** | React Refresh + RN-web runtime | `packages/browser-metro/src/runtime/index.ts`, `packages/browser-metro/src/runtime/react-refresh.ts`, `packages/browser-metro/src/runtime/rn-web-shim.ts` | TC.1 | `bun test packages/browser-metro/src/runtime/__tests__/` |
| **TC.4** | Main-thread host class | `packages/browser-metro/src/host/index.ts`, `packages/browser-metro/src/host/broadcast.ts` (BroadcastChannel publisher), `packages/browser-metro/src/host/code-fs-adapter.ts` (reads from `@onlook/file-system`'s `CodeFileSystem`) | TC.1 | `bun test packages/browser-metro/src/host/__tests__/host.test.ts` |
| **TC.5** | Tests for the public API | `packages/browser-metro/__tests__/integration.test.ts` — feeds an in-memory `CodeFileSystem` into a `BrowserMetro` host and asserts a bundle is produced and broadcast | TC.1, TC.2, TC.3, TC.4 | `bun test packages/browser-metro` |

**Wave C merge gate:** `packages/browser-metro` is a working workspace package; integration test passes.

---

## Wave D — Sandbox/session integration (SEMI-SERIAL, max 2 concurrent)

These tasks all touch `apps/web/client/src/components/store/editor/sandbox/`. Two of them touch `session.ts`, which is a hotspot — they must NOT run in parallel against each other. The orchestrator schedules TD.1 → TD.2 sequentially against `session.ts`. TD.3 and TD.4 can run in parallel because they touch different files.

| ID | Title | Files | Depends | Validate |
|---|---|---|---|---|
| **TD.1** | `SessionManager.ping` → `provider.ping()` | `apps/web/client/src/components/store/editor/sandbox/session.ts` (only the `ping()` method) | Wave A | `bun test apps/web/client/src/components/store/editor/sandbox/__tests__/session.test.ts -- --grep ping` |
| **TD.2** | `SessionManager.createTerminalSessions` capability gate + `start` reads `branch.providerType` | `apps/web/client/src/components/store/editor/sandbox/session.ts` (the `createTerminalSessions` and `start` methods) | TD.1, T0.4, T0.5 | `bun test apps/web/client/src/components/store/editor/sandbox/__tests__/session.test.ts` (full file). Test asserts: for an ExpoBrowser provider, only the task session is created — no `createTerminal` call. |
| **TD.3** | `SandboxManager` passes provider to `GitManager` | `apps/web/client/src/components/store/editor/sandbox/index.ts` (only the `GitManager` instantiation site) | Wave A | `bun test apps/web/client/src/components/store/editor/sandbox/__tests__/index.test.ts` |
| **TD.4** | `GitBackend` interface + `ShellGitBackend` extraction | `apps/web/client/src/components/store/editor/git/git-backend.ts` (NEW, interface), `apps/web/client/src/components/store/editor/git/shell-git-backend.ts` (NEW, extracts existing CSB calls into the interface). **Does NOT touch `git.ts`.** | — | `bun test apps/web/client/src/components/store/editor/git/__tests__/shell-git-backend.test.ts` |
| **TD.5** | `IsomorphicGitBackend` over `CodeFileSystem` | `apps/web/client/src/components/store/editor/git/iso-git-backend.ts` (NEW). Adds `isomorphic-git` to `apps/web/client/package.json`. | TD.4 | `bun test apps/web/client/src/components/store/editor/git/__tests__/iso-git-backend.test.ts` (operates over an in-memory CodeFileSystem, asserts `init`, `add`, `commit`, `log`, `status` all work) |
| **TD.6** | `GitManager` selects backend by capability | `apps/web/client/src/components/store/editor/git/git.ts` (modify constructor to accept provider, pick backend) | TD.4, TD.5 | `bun test apps/web/client/src/components/store/editor/git/__tests__/git.test.ts` (tests both backends through the GitManager surface) |

**Wave D merge gate:** Editor session boots cleanly for both CSB and ExpoBrowser branches. Git operations work via the appropriate backend.

---

## Wave E — E2E spec scaffolding (PARALLEL, up to 8 concurrent)

Land the Playwright specs **in parallel** with Wave A–D. The spec files exist as test scaffolding even before the implementations they exercise are merged — they just fail until those land. The orchestrator runs each spec as the corresponding Wave A–D task completes.

If `apps/web/client/e2e/` doesn't exist yet, **TE.0** scaffolds it first.

| ID | Title | Files | Depends | Validate |
|---|---|---|---|---|
| **TE.0** | E2E scaffold (Playwright config + auth fixture + test branch fixture) | `apps/web/client/playwright.config.ts`, `apps/web/client/e2e/fixtures/auth.ts`, `apps/web/client/e2e/fixtures/test-branch.ts` | — | `bunx playwright test --list` |
| **TE.1** | Spec: `ExpoBrowser` provider stub boots without errors | `apps/web/client/e2e/expo-browser/provider-boot.spec.ts` | TE.0 | `bunx playwright test e2e/expo-browser/provider-boot.spec.ts` |
| **TE.2** | Spec: file ops round-trip via Supabase Storage | `apps/web/client/e2e/expo-browser/file-ops.spec.ts` | TE.0 | `bunx playwright test e2e/expo-browser/file-ops.spec.ts` |
| **TE.3** | Spec: preview iframe renders default template | `apps/web/client/e2e/expo-browser/preview-render.spec.ts` | TE.0 | `bunx playwright test e2e/expo-browser/preview-render.spec.ts` |
| **TE.4** | Spec: hot reload after file edit | `apps/web/client/e2e/expo-browser/hot-reload.spec.ts` | TE.0 | `bunx playwright test e2e/expo-browser/hot-reload.spec.ts` |
| **TE.5** | Spec: chat agent installs a package via interceptor | `apps/web/client/e2e/expo-browser/agent-install.spec.ts` | TE.0 | `bunx playwright test e2e/expo-browser/agent-install.spec.ts` |
| **TE.6** | Spec: chat agent uses in-process glob/grep | `apps/web/client/e2e/expo-browser/agent-search.spec.ts` | TE.0 | `bunx playwright test e2e/expo-browser/agent-search.spec.ts` |
| **TE.7** | Spec: git status via isomorphic-git | `apps/web/client/e2e/expo-browser/git-status.spec.ts` | TE.0 | `bunx playwright test e2e/expo-browser/git-status.spec.ts` |
| **TE.8** | Spec: in-browser screenshot capture flow | `apps/web/client/e2e/expo-browser/screenshot.spec.ts` | TE.0 | `bunx playwright test e2e/expo-browser/screenshot.spec.ts` |
| **TE.9** | Spec: settings toggle switches provider | `apps/web/client/e2e/expo-browser/settings-toggle.spec.ts` | TE.0 | `bunx playwright test e2e/expo-browser/settings-toggle.spec.ts` |
| **TE.10** | Spec: multi-branch project (CSB + ExpoBrowser side by side) | `apps/web/client/e2e/expo-browser/multi-branch.spec.ts` | TE.0 | `bunx playwright test e2e/expo-browser/multi-branch.spec.ts` |
| **TE.11** | Spec: click-to-edit (penpal) works in new preview | `apps/web/client/e2e/expo-browser/click-to-edit.spec.ts` | TE.0 | `bunx playwright test e2e/expo-browser/click-to-edit.spec.ts` |

**Wave E merge gate:** all spec files compile and `playwright test --list` enumerates them. Specs are allowed to fail (red) until their implementing waves land — that's the gating mechanism.

---

## Wave F — CF Worker apps (PARALLEL, up to 8 concurrent)

These are net-new directories with no shared files. Maximum parallelism. Independent of Wave A–E.

| ID | Title | Files | Validate |
|---|---|---|---|
| **TF.1** | `cf-esm-builder` Dockerfile (vendor reactnative-esm) | `apps/cf-esm-builder/Dockerfile`, `apps/cf-esm-builder/.dockerignore` | `docker build apps/cf-esm-builder` succeeds locally; image size ≤ 300MB |
| **TF.2** | `cf-esm-builder` worker + DO | `apps/cf-esm-builder/src/worker.ts` (EsmBuilder DO + Container proxy) | `cd apps/cf-esm-builder && bun run typecheck && bunx wrangler deploy --dry-run` |
| **TF.3** | `cf-esm-builder` wrangler config | `apps/cf-esm-builder/wrangler.jsonc`, `apps/cf-esm-builder/package.json` | `cd apps/cf-esm-builder && bunx wrangler deploy --dry-run` |
| **TF.4** | `cf-esm-cache` worker (R2 cache-first router) | `apps/cf-esm-cache/src/worker.ts` | `cd apps/cf-esm-cache && bun run typecheck && bunx wrangler deploy --dry-run` |
| **TF.5** | `cf-esm-cache` wrangler config | `apps/cf-esm-cache/wrangler.jsonc`, `apps/cf-esm-cache/package.json` | `cd apps/cf-esm-cache && bunx wrangler deploy --dry-run` |
| **TF.6** | `cf-expo-relay` worker (HTTP router) | `apps/cf-expo-relay/src/worker.ts` | `cd apps/cf-expo-relay && bun run typecheck && bunx wrangler deploy --dry-run` |
| **TF.7** | `cf-expo-relay` Durable Object (WebSocket session) | `apps/cf-expo-relay/src/session.ts` | unit test for the DO message protocol; `wrangler deploy --dry-run` |
| **TF.8** | `cf-expo-relay` wrangler config | `apps/cf-expo-relay/wrangler.jsonc`, `apps/cf-expo-relay/package.json` | `cd apps/cf-expo-relay && bunx wrangler deploy --dry-run` |
| **TF.9** | Pre-warm script | `scripts/warm-esm-cache.sh` | `shellcheck scripts/warm-esm-cache.sh` (no errors); dry-run prints package URLs |

**Wave F merge gate:** all three Worker apps `wrangler deploy --dry-run` cleanly. Real deploys happen later as a manual step.

---

## Wave G — Position B migration (PARALLEL, up to 8 concurrent)

The core of dropping CSB hard-coding. **Each call site is its own task** so file ownership stays clean. Wave G depends on T0.7 (the helper signature change) but not on Wave A–F.

| ID | Title | Files | Validate |
|---|---|---|---|
| **TG.1** | Refactor `getSandboxPreviewUrl` call site in `routers/project/project.ts:84` | `apps/web/client/src/server/api/routers/project/project.ts` | `bun run typecheck && bun test apps/web/client/src/server/api/routers/project/__tests__/project.test.ts` |
| **TG.2** | Refactor 3 call sites in `routers/project/sandbox.ts` (lines 120, 200, 260) + add hibernate/shutdown capability gates | `apps/web/client/src/server/api/routers/project/sandbox.ts` | `bun test apps/web/client/src/server/api/routers/project/__tests__/sandbox.test.ts` |
| **TG.3** | Refactor 2 call sites in `routers/project/branch.ts` (lines 129, 274) + expose `providerType` in branch responses | `apps/web/client/src/server/api/routers/project/branch.ts` | `bun test apps/web/client/src/server/api/routers/project/__tests__/branch.test.ts` |
| **TG.4** | Refactor call site in `routers/project/fork.ts:74` | `apps/web/client/src/server/api/routers/project/fork.ts` | `bun test apps/web/client/src/server/api/routers/project/__tests__/fork.test.ts` |
| **TG.5** | Refactor call site in `template-modal.tsx:105` | `apps/web/client/src/app/projects/_components/templates/template-modal.tsx` | `bun test apps/web/client/src/app/projects/_components/templates/__tests__/template-modal.test.tsx` |
| **TG.6** | Refactor call site in `expo-qr-button.tsx:28` | `apps/web/client/src/app/project/[id]/_components/bottom-bar/expo-qr-button.tsx` | unit test |
| **TG.7** | `SessionManager.hibernate` capability gate | `apps/web/client/src/components/store/editor/sandbox/session.ts` (only the `hibernate` method) | unit test asserts no-op for ExpoBrowser. **Sequenced AFTER TD.2** to avoid file conflict on `session.ts`. |
| **TG.8** | Publish dropdown disclaimer for ExpoBrowser branches | `apps/web/client/src/app/project/[id]/_components/top-bar/publish/dropdown/provider.tsx` | snapshot test asserts disclaimer renders |
| **TG.9** | Preview-domain-section disclaimer | `apps/web/client/src/app/project/[id]/_components/top-bar/publish/dropdown/preview-domain-section.tsx` | snapshot test |
| **TG.10** | Custom-domain disclaimer | `apps/web/client/src/app/project/[id]/_components/top-bar/publish/dropdown/custom-domain/provider.tsx` | snapshot test |

**Wave G merge gate:** `bun run typecheck` passes globally (every `getSandboxPreviewUrl` call site is now provider-aware). E2E spec TE.9 (settings toggle) starts to pass.

---

## Wave H — Preview pipeline integration (PARTIALLY PARALLEL)

Each task is one file. TH.4 modifies `view.tsx` which is a hotspot — it gets a single owner. Depends on Wave C (browser-metro).

| ID | Title | Files | Depends | Validate |
|---|---|---|---|---|
| **TH.1** | Service worker | `apps/web/client/public/preview-sw.js` (NEW) | Wave C | unit test for the SW message handler (jest-fetch-mock or similar) |
| **TH.2** | HTML shell served by SW | `apps/web/client/public/preview-shell.html` (NEW) | TH.1 | snapshot test |
| **TH.3** | SW register client island | `apps/web/client/src/components/preview/preview-sw-register.tsx` (NEW) | TH.1 | unit test asserts `serviceWorker.register('/preview-sw.js')` is called when active provider is ExpoBrowser |
| **TH.4** | Frame URL routing in canvas | `apps/web/client/src/app/project/[id]/_components/canvas/frame/view.tsx` (only the `frame.url` derivation; iframe element unchanged) | Wave G (so providerType is reachable from the frame model) | E2E TE.3 (preview render) passes |
| **TH.5** | Preload script `captureScreenshot` extension | `apps/web/client/public/onlook-preload-script.js` (additive; the file exists today) | TH.2 | E2E TE.8 (screenshot) passes |
| **TH.6** | env vars in `apps/web/client/src/env.ts` | `apps/web/client/src/env.ts` | — | `bun run typecheck` |

**Wave H merge gate:** preview iframe renders for an ExpoBrowser branch. TE.3, TE.4, TE.8, TE.11 (preview render, hot reload, screenshot, click-to-edit) all pass.

---

## Wave I — Settings UI + user flag (PARALLEL, up to 4 concurrent)

| ID | Title | Files | Depends | Validate |
|---|---|---|---|---|
| **TI.1** | tRPC procedure `user.getFeatureFlags` | `apps/web/client/src/server/api/routers/user.ts` (modify or create) | T0.6 | `bun test apps/web/client/src/server/api/routers/__tests__/user.test.ts` |
| **TI.2** | `useUserFeatureFlags` React hook | `apps/web/client/src/hooks/use-user-feature-flags.tsx` (NEW) | TI.1 | unit test with a mocked tRPC client |
| **TI.3** | "Preview runtime" radio in settings modal | `apps/web/client/src/components/ui/settings-modal/project/index.tsx` | TI.2, T0.5 | E2E TE.9 (settings toggle) passes |
| **TI.4** | Internal admin route to flip flags | `apps/web/client/src/app/admin/feature-flags/page.tsx` (NEW), `apps/web/client/src/server/api/routers/admin.ts` (or modify) | TI.1 | unit test for the admin procedure (gated on existing admin check) |

**Wave I merge gate:** TE.9 passes; admin can flip the flag for a test user via the admin route.

---

## Wave J — End-to-end smoke (SERIAL, 1 agent)

These run on the merged `feat/expo-browser-provider` branch after every other wave is in. They're the final acceptance gates that match the Sprint 0 and Sprint 1 DoDs from the implementation plan.

| ID | Title | Validate | Source |
|---|---|---|---|
| **TJ.1** | Sprint 0 DoD smoke | `bunx playwright test e2e/expo-browser/sprint-0-dod.spec.ts` (consolidates: scaffold present, migrations applied, stub provider boots, no console errors, publish disclaimer renders) | §0 DoD |
| **TJ.2** | Sprint 1 DoD smoke | `bunx playwright test e2e/expo-browser/sprint-1-dod.spec.ts` (consolidates: edit → preview within 1s with Refresh, click-to-edit, multi-frame, two-tab realtime, all chat agent flows, multi-branch, screenshot capture, CSB never invoked) | §1 DoD |
| **TJ.3** | Full lint + typecheck + test sweep on the integration branch | `bun run lint && bun run typecheck && bun test && bunx playwright test` | — |

**Wave J merge gate:** the three smokes pass on `feat/expo-browser-provider`. Branch is ready for human review and merge to `main`.

---

## Sprint 2/3/4 task waves (placeholder)

Waves K (Sprint 2 — package CDN), L (Sprint 3 — Expo Go), and M (Sprint 4 — polish) follow the same decomposition pattern. They are not detailed here because:
- Wave F already lands the CF Worker scaffolds; Sprint 2 just turns them on.
- Sprint 3 adds the QR UI — ~6 small tasks (button component, modal, WebSocket client, hot-reload pusher, console forwarder, error overlay).
- Sprint 4 is observability + edge-case hardening — task list will be drafted after Sprint 1 lands and we know what actually breaks.

These will be added to this file once Wave J completes.

---

## Dependency DAG (compact)

```
T0.1 → T0.2 → T0.3 → T0.4 → T0.5 → T0.6 → T0.7
                                              │
                  ┌───────────────────────────┼─────────────────────────┐
                  │                           │                         │
                  ▼                           ▼                         ▼
       Wave A (TA.1–TA.9)          Wave C (TC.1 → TC.2/3/4 → TC.5)  Wave F (TF.1–TF.9)
                  │                           │                         │
                  ▼                           ▼                         │
       Wave B (TB.1–TB.6)          Wave H (TH.1–TH.6)                   │
                  │                           │                         │
                  ▼                           │                         │
       Wave D (TD.1→TD.2, TD.3,      ┌────────┘                         │
              TD.4 → TD.5 → TD.6)    │                                  │
                  │                  │                                  │
                  └──────────────────┼────────┐                         │
                                     │        │                         │
                  Wave E (TE.0 → TE.1–TE.11)  │                         │
                                     │        │                         │
                                     ▼        ▼                         │
                              Wave G (TG.1–TG.10)                       │
                                     │                                  │
                                     ▼                                  │
                              Wave I (TI.1 → TI.2 → TI.3, TI.4)         │
                                     │                                  │
                                     └──────────────┬───────────────────┘
                                                    │
                                                    ▼
                                            Wave J (TJ.1 → TJ.2 → TJ.3)
```

---

## Per-task agent prompt template

When dispatching a task to an agent, use this template. Substitute `<bracketed>` fields from the task table.

```
You are working in an isolated git worktree for task <ID>: <Title>.

Worktree path: .trees/<id>-<slug>/
Branch:        ai/<id>-<slug>
Source plan:   plans/expo-browser-implementation.md (read §<source-section>)
Task queue:    plans/expo-browser-task-queue.md (your row + the conventions section)

Files you may modify (NO others):
<files>

Files you may read (anywhere in the repo, but do not modify):
- plans/expo-browser-implementation.md
- plans/expo-browser-task-queue.md
- The files listed above
- Any test files you need to update for your changes

Your acceptance gate (run from the worktree root):
$ <validate command>

The gate must exit 0. You have 3 attempts. If it still fails after 3, report
the failure with full test output and stop — a human will pick it up.

Constraints:
- Do NOT modify any file outside the "may modify" list above. If you find you
  need to, STOP and report — that means the task needs to be split.
- Do NOT introduce new dependencies unless the task description names them.
- Do NOT run `bun run db:gen` (CLAUDE.md forbids it).
- Do NOT run the dev server.
- Match existing code style. The repo uses Bun, TypeScript strict mode, ESLint.
- Keep the diff minimal — no incidental refactors.

When done:
1. Run the validate command. Confirm exit 0.
2. Stage and commit on the worktree's branch with a message like:
   "<id>: <title>"
3. Stop. The orchestrator will merge your branch.
```

---

## Failure handling

### Per-task retry policy
- **Attempt 1:** Agent runs the task with the prompt above.
- **Attempt 2:** If validate fails, the orchestrator pipes the test output back to the same agent with the message: "Your last attempt failed validation. Output below. Read it carefully, fix the issue, and try again. You have 2 attempts left."
- **Attempt 3:** Same as attempt 2 with "1 attempt left."
- **Dead letter:** After 3 attempts, the worktree is preserved (not removed), the branch is not merged, and the task is marked `dead_letter` for human review. The worktree path and the last failure log go into `plans/expo-browser-task-queue.dead-letter.log`.

### Per-merge retry policy
- After a worktree merges to `feat/expo-browser-provider`, the orchestrator runs `bun run typecheck && bun test`.
- If integration fails, **immediately revert that merge** (`git revert HEAD`), dead-letter the task, and continue with the next pending task.
- Never attempt to fix integration failures in the integration branch — always go back to the per-task worktree.

### Hotspot file conflicts
- The orchestrator maintains a per-file lock table. Before dispatching a task, it checks the task's "Files you may modify" list against the locks. If any file is locked by an in-flight task, the task is held in pending.
- This prevents two parallel tasks from racing on the same file even if their wave assignment was wrong.

### Dependency violations
- If a task is dispatched whose `depends` row hasn't merged yet, the orchestrator holds it. Tasks whose dependencies dead-letter are also dead-lettered (cascading failure).

---

## Cleanup

After Wave J merges (or after any abort):

```bash
# List all ai/* worktrees and branches
git worktree list | grep '.trees/'
git branch --list 'ai/*'

# Remove all worktrees
git worktree list --porcelain | grep 'worktree ' | awk '{print $2}' | grep '.trees/' | xargs -n 1 git worktree remove --force

# Delete all ai/* branches (safe — they're already merged)
git branch --list 'ai/*' | xargs -n 1 git branch -D

# Prune .trees/ if any stragglers remain
rm -rf .trees/
```

---

## Open questions before dispatching agents

1. **E2E framework choice** — this plan assumes Playwright. If the team uses something else, Wave E task definitions need to be regenerated against that framework.
2. **CI runner concurrency** — the queue assumes 8 parallel agents on a single laptop. If running in CI with more cores, the cap can be raised, but watch for `bun install` being slow on cold caches.
3. **Supabase Storage bucket creation** — TA.5 assumes the `expo-projects` bucket exists. Should the bucket creation be its own pre-Phase-0 manual step, or a Sprint 0 task we add as T0.0?
4. **Real Cloudflare deploys** — Wave F tasks only run `wrangler deploy --dry-run`. Real deploys (with the actual R2 buckets, KV namespaces, Container builds) need an admin with CF credentials and probably should not be agent-dispatched. Add as a manual checklist between Wave J and the merge to `main`?
5. **`html2canvas` accuracy on RN-web** — TH.5 assumes the screenshot library handles react-native-web's DOM output correctly. If it doesn't (some RN components render to canvas/SVG), TH.5 needs a v2 task to swap in `dom-to-image-more` or similar. Worth a 30-min spike before TH.5 lands.

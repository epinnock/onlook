# Parallel Execution Methodology

*The Onlook-specific playbook for running up to 16 concurrent AI agents on independent tasks.*

*Canonical operating rule lives in `CLAUDE.md` under "Operating mode" and "Parallel execution methodology". This doc is the detail companion.*

---

## Why this exists

Solo AI coding tops out at ~1 agent × 1 task. The ceiling moves when:

1. Work is decomposed into independent, single-file tasks (≤3 files).
2. Each agent gets a fully isolated source tree (git worktree).
3. Each task's success/failure is a deterministic test (not a human review).
4. A shared queue schedules tasks by dependency DAG.

Research consensus: accuracy drops from ~87% on single-file tasks to ~19% on multi-file tasks. Decomposition is the whole ball game.

The practical ceiling per laptop is 5–7 concurrent agents. Across machines (or with aggressive scheduling), we target 16. The architecture below supports either.

---

## Three pillars

### 1. Worktrees as isolation

Every parallel agent gets:

- Its own working directory under `.trees/<task-id>-<slug>/`
- Its own branch `ai/<task-id>-<slug>` off the integration branch
- Shared `.git` object store (no commit-history duplication)
- Independent `node_modules` (via `bun install` in the worktree)

Lifecycle:

```bash
# Create
git worktree add -b ai/A1-extract-shims .trees/A1-extract-shims feat/mobile-preview-shim
cd .trees/A1-extract-shims
bun install

# Work
export PREVIEW_SLOT=3          # Your assigned slot (0-15)
bun run typecheck
bun test <task-spec>
bunx playwright test <e2e-spec>
git commit -am "..."
git push origin ai/A1-extract-shims

# Merge
gh pr create --base feat/mobile-preview-shim --title "A1: ..."
# After merge, cleanup
git worktree remove .trees/A1-extract-shims
git branch -D ai/A1-extract-shims
```

**Key files auto-copied into new worktrees** (via `.worktreeinclude`):

- `apps/web/client/.env.local` (contains NEXT_PUBLIC_MOBILE_PREVIEW_URL — each worktree overrides per-slot)
- `.claude/settings.local.json`
- `node_modules` is NOT copied; each worktree runs its own `bun install`. Bun's global cache makes subsequent installs ~instant.

### 2. Task decomposition

Every task in a queue declares:

- **ID** (stable, citable)
- **Blocks on:** task IDs that must complete first
- **Blocks:** task IDs that unblock when this completes
- **Files:** the exact file paths this task may read or write
- **Deliverable:** what finishing produces
- **Acceptance:** the test command that proves it's done
- **Effort:** rough hours (1 day ≈ 6h focused)
- **Parallel-safe with:** other task IDs running concurrently

**Granularity ladder:**

| Scope | Recommendation |
|---|---|
| 1 file, 1 function | Ideal — claim freely |
| 2–3 files in one module | Acceptable |
| 4+ files or crossing modules | Split first — don't claim as-is |
| "Implement feature X" | Don't — decompose in Wave 0 |

**Hotspot files** (registries, barrel exports, `package.json`, `env.ts`) have exactly one owner per wave or are auto-generated. If two tasks in the same wave want to edit the same hotspot, split them into Wave N (edit the hotspot) and Wave N+1 (use the updated hotspot).

**Interface-first waves.** Structure work as alternating sequential/parallel phases:

- **Wave 0 (sequential):** Define shared types, interfaces, protocol shapes.
- **Wave 1 (parallel):** Fan out implementation tasks against the Wave 0 contracts.
- **Wave 2 (sequential):** Merge + integration test.
- **Wave 3 (parallel):** Build next layer against newly-merged Wave 1.

Each wave is a clean sync point.

### 3. E2E validation gates

Every task's **acceptance criterion is a test command that exits 0 or non-0**. No manual inspection.

Three test layers:

1. **Typecheck** — `bun run typecheck` from the worktree root. Must pass.
2. **Unit** — `bun test <spec>` against the task's target code.
3. **E2E** — `bunx playwright test <spec>` for UI flows. Specs live under `apps/web/client/e2e/<feature>/`.

**Self-correction loop:** on failure, the agent feeds the test output back as context and retries. Cap at 3 retries. On exhaustion, the task is dead-lettered for human review; the worktree is discarded and the work is not merged.

**Wave gate:** before a wave fans out to the next, the integration branch runs the full test suite. Green = proceed. Red = fix the regression before opening more tasks.

---

## Shared-resource coordination

Worktrees isolate source; everything else is shared:

| Resource | Risk | Mitigation |
|---|---|---|
| Postgres (Supabase local) | Schema reset blows up other agents' tests | All migrations are Wave 0 tasks. `bun run db:push` serialized. |
| `/tmp/cf-builds/` | Build-artifact collisions | Slot-prefixed subdirs: `/tmp/cf-builds/slot-${PREVIEW_SLOT}/` |
| Docker daemon | Container name collisions | Names include `${PREVIEW_SLOT}` suffix |
| Expo Go on a physical phone | One device, one runtime | Device tests are serialized; automated E2E runs without a phone |
| Ports (Next.js, mobile-preview HTTP, WS) | Bind failures | Slot-based offsets (see port table below) |
| `apps/web/client/.env.local` | Per-worktree env | Each worktree writes its own copy with slot-specific `NEXT_PUBLIC_MOBILE_PREVIEW_URL` |

### Port allocation

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

Per-worktree setup:

```bash
export PREVIEW_SLOT=<0-15>
export WEB_PORT=$((3100 + PREVIEW_SLOT))
export MOBILE_PREVIEW_PORT=$((8787 + PREVIEW_SLOT))
export MOBILE_PREVIEW_WS_PORT=$((8887 + PREVIEW_SLOT))
export PLAYWRIGHT_BASE_URL="http://127.0.0.1:${WEB_PORT}"
export NEXT_PUBLIC_MOBILE_PREVIEW_URL="http://127.0.0.1:${MOBILE_PREVIEW_PORT}"
export CF_BUILDS_DIR="/tmp/cf-builds/slot-${PREVIEW_SLOT}"
```

---

## Branch + merge model

```
main
 └── feat/mobile-preview-shim      (integration branch, runs full suite on merge)
       ├── ai/A1-extract-shims
       ├── ai/A4-native-modules
       ├── ai/B2-handler-map
       ├── ai/E1a-expo-constants
       └── ...
```

- Agents **never** merge to `main` directly.
- Agents merge to their area's integration branch (`feat/mobile-preview-shim`, `feat/mobile-client`, etc.).
- Integration branch → main happens at milestone boundaries (see `plans/mobile-preview-shim-implementation.md` "Rollout milestones") with a full release test run.
- Destructive operations (force-push to integration, drop migrations) require explicit human approval per the operating-mode rule.

---

## Queue doc conventions

Each parallel area has one queue doc:

- `plans/mobile-preview-shim-task-queue.md` — mobile-preview shim (Workstreams A–G)
- `plans/onlook-mobile-client-task-queue.md` — mobile-client iOS custom dev client (create when scope is defined)
- Future: `plans/<area>-task-queue.md` for other parallel areas

Each queue has:

1. **Dependency graph** (high-level ASCII)
2. **Decomposition rules** (file ownership, hotspot handling)
3. **Worktree + port conventions** (link to this doc)
4. **Validation model** (typecheck + unit + E2E)
5. **Tasks** — one block per task with the full metadata above
6. **Parallelization groups** — which task IDs can run concurrently
7. **Status log** — claimed/in-progress/done table, updated by agents

---

## Mid-task decisions: ADRs

When an agent hits a design fork mid-task, the operating mode says: **pick and document, don't pause**. Documentation goes to `plans/adr/NNNN-<slug>.md` using the template at `plans/adr/template.md`.

Examples of ADR-worthy decisions:

- "Shims live in a single bundle or lazy chunks?"
- "Asset inlining threshold: 256KB or 1MB?"
- "Event bubbling: walk the React tree or the Fabric tag map?"

Examples that don't need an ADR (just commit-message rationale):

- Renaming a local variable
- Adding a test for an existing function
- Choosing between two implementations that are genuinely equivalent

---

## Cleanup

At the end of a session or when an integration branch is merged:

```bash
# Remove finished worktrees
git worktree list --porcelain | grep '.trees/' | awk '/^worktree / {print $2}' | xargs -n1 git worktree remove

# Bulk-delete merged AI branches
git branch --list 'ai/*' --merged | xargs -n1 git branch -d

# Prune stale worktree refs
git worktree prune
```

---

## Failure modes to watch for

1. **Two agents editing the same file.** The queue's "Files" list is the contract. If a task turns out to need a file not in its list, the agent escalates (splits the task, doesn't silently grow scope).
2. **Drifting interfaces.** Wave 0 types get edited mid-wave. Fix: Wave 0 tasks are serialized and merged before any Wave 1 task starts.
3. **Shared DB state corruption.** An agent drops a table; others' tests break. Fix: DB migrations are Wave 0 only; runtime tests use transactions that roll back.
4. **Port collisions.** Agent didn't set `PREVIEW_SLOT`. Fix: each worktree's `setup.sh` asserts the env var is set before running dev commands.
5. **Uncoordinated error amplification.** 10-step parallel process with 99% per-step success = 90% overall. Fix: hard retry caps (3), dead-letter for human review, full-suite wave gates.

---

## Related docs

- `CLAUDE.md` — canonical operating rules (ports, decomposition, keep-going rule)
- `plans/adr/README.md` — when and how to write ADRs
- `plans/mobile-preview-shim-implementation.md` — strategic plan this queue executes
- `plans/mobile-preview-shim-task-queue.md` — first live parallel queue
- `plans/mobile-preview-shim-references.md` — research bibliography per workstream

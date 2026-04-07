# Expo browser E2E — orchestrator handoff

You are taking over execution of a 76-task parallel queue that finishes the
ExpoBrowser provider for Onlook. This document is everything you need to
start dispatching agents within 30 minutes. Read it top-to-bottom once
before touching anything.

**Author of the queue:** prior Claude session (transcript at
`/Users/ejirohome/.claude/projects/-Users-ejirohome-Documents-Projects-scry-scry-ide-onlook/574f3350-2fd1-4f90-b0a2-a7d15f959721.jsonl`).
That session left the repo in a runnable state with verified scenarios
01–05 already passing. You're picking up at scenarios 06–14.

---

## TL;DR

1. Read the four files in §"Required reading" below (≈30 min).
2. Run §"Pre-flight checks" (≈10 min). Resolve anything that fails before dispatching.
3. Pick the first task from `plans/expo-browser-e2e-task-queue.md` Wave R0 (it's `TR0.1`). Dispatch one agent against it. Wait for merge. Pick the next.
4. Once Wave R0 is fully merged, fan out to up to 8 concurrent agents per the per-wave concurrency caps in the queue file.
5. After every merge: `bun run typecheck && bun test`. If integration breaks, **revert that merge immediately** (do not try to fix in the integration branch — go back to the worktree).
6. When you hit a dead-letter or a hotspot collision you can't resolve, document it in `plans/expo-browser-e2e-task-queue.dead-letter.log` and escalate to the human owner (the user — VP-level engineer at Scry/Onlook).

The full critical path is ~16 sequential merges with 8-wide fan-out in between. Realistic wall time at 6–8 concurrent agents: roughly 2–3 working days, dominated by Wave H (Container builds + Hermes bundling).

---

## Required reading (in this order)

1. **`plans/expo-browser-implementation.md`** — the canonical "what and why."
   Read sections §0 (sprint overview), §1 (architecture), and §3 (DoD) at minimum.
   Skip the deep code blocks unless you're stuck on a specific task later.

2. **`plans/expo-browser-task-queue.md`** — the parent queue (Waves 0–J, already merged).
   Read the **Conventions** section in full — it defines worktree layout,
   branch naming, per-worktree dependency install, scope guards (`.claude/rules.md`),
   retry policy, dead-letter rules, and the per-task agent prompt template.
   Everything in the new queue inherits from here. Only read tables for waves
   you have to investigate (most tasks are done).

3. **`plans/expo-browser-e2e-task-queue.md`** — **THIS is your queue.**
   76 tasks across Phase R (real bundle in canvas iframe), Phase H (Hermes bundle
   for true Expo Go), Phase Q (QR UI), Phase Z (verification refresh). Read all
   of it. The "Validation gate — Chrome MCP, not Playwright" section is the
   single most important thing to internalize — the e2e gate is a markdown spec
   walked by the agent itself, not a shell-runnable test.

4. **`plans/expo-browser-status.md`** — what's already merged (Waves 0–J).
   Skim. Look for the "Phase R bugs" section if it's been added by `TR0.1`;
   if not, that section is the first task you dispatch.

Optional but useful:
- `apps/web/client/verification/onlook-editor/README.md` — how the existing
  scenarios 01–05 were validated. Same shape as what you'll add for 06–14.
- `apps/web/client/verification/onlook-editor/results.json` — current state.
  Scenarios 01–05 are `passed`, 06–14 are not yet present (R0.3 adds them).
- `~/.claude/skills/verify-with-browser/SKILL.md` — the skill agents will use
  for Chrome MCP walks. Read it once so you understand what agents are doing
  during their layer-2 validation.

---

## Pre-flight checks

Run these from `/Users/ejirohome/Documents/Projects/scry/scry-ide/onlook/`. Each has a "must" or "nice to have" tag.

| # | Command | Expected | Tag |
|---|---|---|---|
| 1 | `bun --version` | `≥ 1.1` | must |
| 2 | `git worktree list` | shows main + `.trees/integration` on `feat/expo-browser-provider` | must |
| 3 | `git -C .trees/integration log --oneline -3` | top commit is `cd2035ab Wave H + I verification: end-to-end Onlook editor suite` (or later) | must |
| 4 | `docker info \| head -3` | docker daemon responding | **must for Phase H** (H1–H3 dead-letter without it) |
| 5 | `docker ps --format '{{.Names}}' \| grep supabase_db_onlook-web` | container present | must |
| 6 | `curl -sf http://127.0.0.1:54321 -o /dev/null -w "%{http_code}\n"` | `404` (Supabase root has no route — 404 means it's reachable) | must |
| 7 | `lsof -nP -iTCP:3001 -sTCP:LISTEN \| grep -q LISTEN && echo "3001 in use" \|\| echo "3001 free"` | depends — see note below | informational |
| 8 | Chrome MCP available in your Claude session — verify by calling `mcp__chrome-devtools__list_pages` | returns a JSON page list, no error | **must for any task that walks a scenario** |
| 9 | `gh auth status` | logged in to GitHub | must (for TZ.6 PR open) |
| 10 | `which shellcheck` | path to binary | nice (TR0.5 / TQ0.3 / TH0.4 use it) |

**Note on check 7:** there is currently a long-running Next.js dev server on
pid `42168` listening on port 3001, started Tue Apr 7 16:41 from `.trees/integration/apps/web/client`.
It's serving the integration branch's build of the editor. You can leave it
alone — your worktree-spawned dev servers should use ports 3002–3008 (the
queue's port allocator does this automatically). If you want a clean slate,
`kill 42168` is safe; the launcher in `TR0.5` boots a fresh one on demand.

**If check 4 (Docker) fails:** Phase H1–H3 are blocked. You can still run all
of Phase R, plus Phase H0 (foundation docs only), Phase Q0–Q2, and Phase Z's
preparatory tasks while you wait for Docker. Mark H1–H3 as `blocked-on-docker`
in your dispatch tracker and start Docker before they unblock.

**If check 8 (Chrome MCP) fails:** every task with a scenario gate will
dead-letter. Resolve before dispatching anything in Wave R3, R4, H5, Q3, Q4.
Wave R0–R2, H0–H4, Q0–Q2 don't need Chrome MCP — they have unit-only gates
and you can run them in parallel while you sort Chrome MCP out.

---

## Repo state snapshot (as of handoff time)

- **Main branch:** `main` at `24eca05e feat: Expo from GitHub template, …`
- **Integration branch:** `feat/expo-browser-provider` at `cd2035ab` (in `.trees/integration`)
- **Active dev server:** pid 42168 on port 3001, serving the integration worktree
- **Local Supabase:** running (see check 5)
- **Test data seeded:** project `2bff33ae-7334-457e-a69e-93a5d90b18b3`, branch `fcebdee5-1010-4147-9748-823a27dc36a3`, user `support@onlook.com`
- **Verified scenarios:** 01–05 (canvas iframe loads, publish disclaimer, settings modal, project tab radio, terminal hidden) — see `verification/onlook-editor/results.json`
- **Pending bugs you must NOT lose** — five real bugs found in browser, documented verbatim in the queue file's "Wave R1 bug list" section. They become tasks `TR1.1`–`TR1.5`. They are reproducible TODAY against the running dev server.
- **Stale rogue file** at `/Users/ejirohome/Documents/Projects/scry/scry-ide/onlook/package-lock.json` (1.3MB, from April 2, untracked, gitignored). DO NOT delete it — it's outside any worktree's scope. Workaround is `NEXT_IGNORE_INCORRECT_LOCKFILE=1` (already baked into the dev launcher in `TR0.5`).

---

## Dispatch model — recommended

The simplest reliable model is **one human running multiple Claude Code
instances in separate terminals**, one per worktree. The community ceiling is
5–7 concurrent on a laptop before merge complexity + review bottleneck consume
the gains. Start with 2–3 agents, add a third when the first two feel
boring.

For each task you dispatch:

```bash
# 1. Create the worktree off the integration branch (NOT main)
TASK=TR0.1
SLUG=document-r1-bugs
git worktree add -b ai/${TASK}-${SLUG} .trees/${TASK}-${SLUG} feat/expo-browser-provider

# 2. Install deps inside the worktree
cd .trees/${TASK}-${SLUG}
bun install

# 3. Drop a scope guard so the agent stays in its lane
mkdir -p .claude
cat > .claude/rules.md <<EOF
# Task scope for ${TASK}

Work ONLY on the files listed in the queue file's row for ${TASK}. Do NOT
modify any other file in the repo. If you find you need to touch a file
outside that list, STOP and report — that means the task needs to be split
or escalated.
EOF

# 4. Launch a Claude Code instance in this worktree
claude --worktree ${TASK}-${SLUG}

# 5. Inside the Claude session, paste the per-task agent prompt
#    (template lives in plans/expo-browser-task-queue.md "Per-task agent
#     prompt template" section, with the delta from
#     plans/expo-browser-e2e-task-queue.md "Per-task agent prompt template
#     (delta from parent)" appended)

# 6. Wait for the agent to commit and report success.

# 7. Run the orchestrator's validate command from the queue file's row.
#    It must exit 0.

# 8. Merge to the integration branch (NOT main)
cd /Users/ejirohome/Documents/Projects/scry/scry-ide/onlook/.trees/integration
git merge --no-ff ai/${TASK}-${SLUG}
bun run typecheck && bun test  # integration check

# 9. Cleanup
git worktree remove ../../${TASK}-${SLUG}  # adjust path
git branch -d ai/${TASK}-${SLUG}
```

**If integration check fails:** `git revert HEAD` immediately, dead-letter the
task, do NOT try to fix in the integration branch.

### Agent prompt template

The full template is in `plans/expo-browser-task-queue.md` under "Per-task
agent prompt template". The delta for Phase R/H/Q is in
`plans/expo-browser-e2e-task-queue.md` under "Per-task agent prompt template
(delta from parent)". Concatenate them. Substitute the bracketed fields from
the task's row in the queue file.

The most important parts to keep verbatim are:
- "Files you may modify (NO others): …"
- "Your acceptance gate: …"
- "NEVER fake a passing assertion. NEVER mark a scenario passed without a
  real screenshot."

Agents drift. The scope guard + the no-fake-assertion clause are what keep
them honest.

---

## How to walk a Chrome MCP scenario (for the agent's benefit)

Most tasks in Wave R3, R4, H5, Q3, Q4 have a scenario in their validate gate.
The agent walks the scenario itself via `mcp__chrome-devtools__*` tools. The
flow:

1. Agent reads the spec markdown at `apps/web/client/verification/onlook-editor/scenarios/<NN>-<slug>.md`.
2. Agent runs the scenario's pre-conditions (dev server up, seed script run, login complete).
3. Agent walks each step via Chrome MCP, asserting DOM state and capturing screenshots.
4. Agent updates `apps/web/client/verification/onlook-editor/results.json` with `state`, `assertions[]`, `verified_at`, `verified_by`.
5. Agent runs the orchestrator's gate: `jq -e '.scenarios["NN"].state == "passed"' results.json`.
6. If the gate fails, the agent debugs and re-walks.

**You don't run scenarios as the orchestrator.** You only check that
`results.json` was updated honestly. Spot-check screenshots periodically by
opening the PNGs in `verification/onlook-editor/results/` — the user will
notice if any of them are blank or wrong.

The `verify-with-browser` skill at `~/.claude/skills/verify-with-browser/SKILL.md`
is what teaches agents the canonical Chrome MCP walk pattern. If an agent
seems lost on how to drive Chrome MCP, point them at that skill.

---

## Concurrency caps and dependency rules

The queue's compact DAG section shows three parallel pipelines (R, H, Q) that
fan out from their respective Wave 0s. Hard rules:

1. **Wave 0 of any phase must complete sequentially before that phase's Wave 1
   can start.** R0 → R1, H0 → H1, Q0 → Q1.
2. **Hotspot files are sequential within a wave.** The queue file marks them
   explicitly (e.g. TR1.1 and TR1.6 both edit `storage.ts` → run sequentially).
   Maintain a per-file lock table — even an in-memory mental one is fine for
   small batches.
3. **Q4 gates on H5.** The QR can't point at a bundle that doesn't exist yet.
   Don't dispatch TQ4.x until TH5.2 has merged.
4. **Z waits for R + H + Q.** All scenarios 06–13 must be `passed` before TZ.1.
5. **Manual gates dead-letter by default.** TH6.1 (real phone test) and TZ.6
   (open PR) require a human to flip them to `ready`. Surface them in your
   tracker but do not dispatch agents at them.
6. **8-agent hard cap.** Some waves list 5–8; 8 is the absolute ceiling
   regardless of what the wave header says. Adding more concurrent agents on a
   single laptop produces merge complexity faster than throughput gains.

---

## Failure handling

### Per-task retry policy
Inherited from the parent queue. Three attempts per task, with the test output
fed back to the agent between attempts. After three failures, mark the task
`dead_lettered` in your tracker. Do NOT delete the worktree — preserve it
so the human reviewer can inspect the agent's work-in-progress.

### Per-merge integration check
After every merge to `feat/expo-browser-provider`, run
`bun run typecheck && bun test`. If anything fails, **`git revert HEAD`
immediately**. Do not try to fix the integration branch directly. Go back to
the per-task worktree and dispatch a follow-up agent.

### Hotspot collisions
If two pending tasks declare the same file, hold the second one until the
first merges. The queue file marks known hotspots; new ones may emerge during
execution.

### Dependency violations
If you accidentally dispatch a task whose deps haven't merged, the agent will
hit a typecheck failure on the import that doesn't exist yet. Stop, revert,
re-dispatch in dep order.

### Dead-letter log
Append every dead-letter to `plans/expo-browser-e2e-task-queue.dead-letter.log`
with: timestamp, task ID, reason, worktree path, last failure log. The human
owner will triage these between sessions.

---

## Known traps / gotchas

1. **`NEXT_IGNORE_INCORRECT_LOCKFILE=1` is mandatory** for every dev server
   start. The launcher in TR0.5 sets it. If you bypass the launcher,
   you'll get "Failed to patch lockfile" spam (non-fatal but noisy).

2. **No `--turbo`.** FOUND-03 from the parent queue: `next dev --turbo` OOMs
   on long verification sessions (SWC native binding heap usage). Use plain
   `next dev`.

3. **`react-native-web` peer compatibility.** Open question #6 in the queue
   file: esm.sh's `react-native-web` may not ESM cleanly. Worth a 15-minute
   spike before Wave R2 starts. Fallback is a CDN-pinned UMD URL pattern.

4. **`expo@54` New Architecture is on by default.** Some npm-installed
   packages still emit warnings under New Arch. Filter them in scenario
   assertions; don't fail tests on `[New Architecture]` warnings.

5. **Cloudflare Containers local emulation is recent.** Open question #2 in
   the queue file. Wrangler's local Container support requires a specific
   version (≥ 3.x). Verify before TH1.4. The `dev-builder.sh` launcher will
   exit 1 with reason `wrangler-version-mismatch` if it detects the wrong
   version.

6. **Chrome MCP isolated contexts.** Use `isolatedContext: 'verify-onlook'`
   when calling `mcp__chrome-devtools__new_page` so the agent's verification
   session doesn't pollute the user's main browsing state. The
   `verify-with-browser` skill teaches this.

7. **`navigate_page` lies sometimes.** The default 10s timeout is too short
   for first-compile of a Next.js route. Pass `timeout: 120000` for any
   navigation in scenarios that hit a not-yet-compiled route. Also confirm
   `window.location.href` after the call — `navigate_page` can return
   "Successfully navigated" while the page is actually unchanged (server-side
   redirect).

8. **Supabase Storage RLS** (Bug R1.3). The browser-side Supabase client uses
   the user's JWT, not service role. The expo-projects bucket policy doesn't
   currently allow inserts under arbitrary project paths. TR1.3 lands the
   migration. Until then, anything that uploads via the browser client will
   hit `new row violates row-level security policy`.

9. **Pre-existing schema drift.** The parent queue's verification surfaced
   FOUND-01 (`conversations.agent_type` missing) and a similar drift on the
   `messages` table. The seed script `setup.sh` patches both. If you see
   "column does not exist" errors during dispatch, re-run the seed script.

10. **The `inferPageFromUrl` crash on relative URLs** (Bug R1.4) is tracked
    as TR1.4. Until it lands, the SW preview URL `/preview/<branchId>/<frameId>/`
    will throw in `packages/utility/src/urls.ts:74`. This is silent in
    production (caught upstream) but visible in scenario assertions.

---

## What success looks like

When you're done:

1. `feat/expo-browser-provider` has all 76 tasks merged.
2. `apps/web/client/verification/onlook-editor/results.json` shows scenarios
   01–13 all `passed`. Scenario 14 (`expo-go-manual.md`) is `dead_lettered`
   with reason `human-only` — that's expected.
3. `bun run lint && bun run typecheck && bun test` passes cleanly on the
   integration branch.
4. `apps/web/client/verification/onlook-editor/reference/` has fresh PNG
   screenshots for scenarios 06–13.
5. A draft PR `feat/expo-browser-provider` → `main` is open in GitHub (TZ.6),
   waiting for the user to review and merge.
6. The user can scan the QR from scenario 11 with a real Expo Go phone and
   see their seeded fixture rendering. (This is the manual TH6.1 step. You
   are NOT responsible for confirming it from the phone — that's the user's
   acceptance.)

---

## Escalation

The user is a VP-level engineer at Scry/Onlook and trusts your judgment on
execution. Escalate when:

- Any of the open questions in the queue file's "Open questions before
  dispatching" section blocks you and isn't resolvable from docs.
- A dead-letter cascade threatens more than 3 downstream tasks.
- You discover a real bug in the code under test that the queue doesn't
  capture (file:line evidence required — mirror the format in the
  "Wave R1 bug list" section).
- You hit a Cloudflare account / wrangler deploy permissions issue.
- The human is asked for a phone test (TH6.1, TZ.6) and isn't responding.

Don't escalate for:
- Routine retries (you have 3 attempts per task).
- Single-task failures that don't block other work.
- Cosmetic / small refactor opportunities you spotted (the queue is
  intentionally minimal — don't expand scope).
- Questions the queue file or parent queue file already answer.

---

## Files you'll touch most

| Path | Why |
|---|---|
| `plans/expo-browser-e2e-task-queue.md` | Source of truth — every task |
| `plans/expo-browser-task-queue.md` | Conventions you inherit from |
| `plans/expo-browser-implementation.md` | The "what and why" — read for context, don't edit |
| `plans/expo-browser-status.md` | Status doc — agents update via TR0.1 |
| `plans/expo-browser-e2e-task-queue.dead-letter.log` | NEW — your dead-letter ledger |
| `apps/web/client/verification/onlook-editor/results.json` | Updated by every scenario walk |
| `apps/web/client/verification/onlook-editor/scenarios/` | NEW — markdown specs land here |
| `apps/web/client/verification/onlook-editor/reference/` | New PNGs land here at TZ.2 |
| `.trees/<task-id>-<slug>/` | Per-task worktrees (gitignored) |
| `/tmp/onlook-verify-<task-id>.log`, `/tmp/cf-esm-builder-<task-id>.log`, `/tmp/cf-expo-relay-<task-id>.log` | Per-worker dev server logs (rotate as needed) |

---

## First three task dispatches (worked example)

### TR0.1 — Document the R1 bugs

```bash
cd /Users/ejirohome/Documents/Projects/scry/scry-ide/onlook
git worktree add -b ai/TR0.1-doc-r1-bugs .trees/TR0.1-doc-r1-bugs feat/expo-browser-provider
cd .trees/TR0.1-doc-r1-bugs
bun install
mkdir -p .claude && cat > .claude/rules.md <<'EOF'
# Task scope for TR0.1
Work ONLY on plans/expo-browser-status.md. Do NOT modify any other file.
EOF
claude --worktree TR0.1-doc-r1-bugs
# Inside Claude: paste the agent prompt template, with these fields:
#   Task: TR0.1 — Document the bugs uncovered during manual verification
#   Files: plans/expo-browser-status.md
#   Validate: grep -q "Phase R bugs" plans/expo-browser-status.md
#   Source: the "Wave R1 bug list" section verbatim from
#           plans/expo-browser-e2e-task-queue.md
```

When the agent reports done:

```bash
grep -q "Phase R bugs" plans/expo-browser-status.md && echo PASS || echo FAIL
cd /Users/ejirohome/Documents/Projects/scry/scry-ide/onlook/.trees/integration
git merge --no-ff ai/TR0.1-doc-r1-bugs
bun run typecheck && bun test
git worktree remove ../TR0.1-doc-r1-bugs
git branch -d ai/TR0.1-doc-r1-bugs
```

### TR0.2 — Fixture spec (sequential after TR0.1)

Same shape. Files: `plans/expo-browser-fixture-spec.md` (NEW). Validate:
`test -f plans/expo-browser-fixture-spec.md`. Note for the agent: pin
**Expo SDK 54** (RN 0.81, React 19.1, Hermes default, New Architecture on),
`react-native-web@~0.21`. The reasoning is spelled out in open question #3 of
the queue file.

### TR0.3 — results.json scenario stubs (sequential after TR0.2)

Files: `apps/web/client/verification/onlook-editor/results.json`,
`apps/web/client/verification/onlook-editor/scenarios/lib/results-schema.md`
(NEW). Validate: `bun -e "JSON.parse(...)" && test -f .../results-schema.md`.

After TR0.3 merges, you can dispatch TR0.4, TR0.5, TR0.6 in **parallel**
(they touch different files). That's where 8-wide fan-out starts paying off.

---

## Questions? Read the queue file first.

Almost everything you need is in the queue file. The queue file's
"Open questions before dispatching" section captures everything that wasn't
known at queue-write time. Resolve those questions as you encounter the
relevant tasks; if a question blocks a whole wave, escalate to the user.

Good luck.

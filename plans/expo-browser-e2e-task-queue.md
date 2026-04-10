# Expo browser E2E — parallel task queue

**Source plan:** `plans/expo-browser-implementation.md` (canonical "what and why").
**Parent queue:** `plans/expo-browser-task-queue.md` (Wave 0 → J landed; this file is the follow-on).
**Parent conventions:** Worktree layout, branch naming, per-worktree dependency install, scope guards, retry policy, dead-letter rules — all inherited from the parent queue file. Read its "Conventions" section before dispatching agents from this file.

**Goal of this queue:** finish the two outstanding integration items the user asked for after Wave J merged:

1. **Phase R** — Real Expo bundle rendering inside Onlook's canvas iframe (a real `react-native-web` component bundled by `@onlook/browser-metro`, served through the preview SW, visible in the editor). Fast-feedback path, IIFE+esm.sh runtime.
2. **Phase H** — Hermes-compatible bundle generation via `cf-esm-builder` (Cloudflare Container running Metro + Hermes), so a real Expo Go app on a phone can load the same project the editor is rendering.
3. **Phase Q** — QR code UI in the editor that points the phone at the Phase H bundle via the existing `cf-expo-relay` Worker.

**User decisions baked in (2026-04-07):**
- **Validation gate is Chrome MCP, not Playwright.** Chrome MCP is driven by Claude (the agent) via the `verify-with-browser` skill. Each scenario is a markdown spec the agent walks through manually, updating `results.json` with pass/fail. Orchestrator's automated validate is `jq -e '.scenarios["XX"].state == "passed"' results.json`.
- **True Expo Go QR**, not in-browser-preview QR. The QR points at a Hermes-compatible bundle produced by `cf-esm-builder` running Metro inside a Cloudflare Container, served via `cf-expo-relay`'s Expo manifest endpoint. Phase R's IIFE bundle is for the canvas iframe only — it's not what the QR serves.

Every task in this queue gates on a real, runnable test. Phases R, H, Q are three pipelines that fan out after their respective Wave 0s land; the cross-pipeline gate is Phase Q's UI which consumes Phase H's bundle URL.

This queue also bakes in the bugs uncovered during the manual browser-MCP verification that was running when this file was written — they are real, reproducible, and have to be in the queue or they'll be forgotten.

---

## Conventions (delta from parent)

Inherit everything from `plans/expo-browser-task-queue.md` "Conventions" section. The following are the deltas specific to this phase:

### Base branch

All worktrees branch from `feat/expo-browser-provider` (the integration branch from the parent queue), **not** `main`. Pattern:

```bash
git worktree add -b ai/<task-id>-<slug> .trees/<task-id>-<slug> feat/expo-browser-provider
```

After validation passes, merge back to `feat/expo-browser-provider`. The integration branch remains the long-running staging branch until Phases R + H + Q are fully verified, then it merges to `main` as one PR.

### Validation gate — Chrome MCP, not Playwright

Per the user's directive, **the e2e validation gate is Chrome MCP driven through the `verify-with-browser` skill**, not Playwright. This has structural implications:

1. **Chrome MCP cannot be invoked from a shell command.** It is an MCP server connected to Claude. A worker agent must walk through the scenario *itself* using its `mcp__chrome-devtools__*` tools.
2. **Each scenario is a markdown spec**, not a test script. The spec lists pre-conditions, step-by-step Chrome MCP calls, DOM assertions, and a screenshot path. The agent reads the spec, walks it via tool calls, captures evidence, then updates `results.json`.
3. **The orchestrator's automated validate is a state check on `results.json`**, not a test runner invocation:
   ```bash
   jq -e '.scenarios["06"].state == "passed"' apps/web/client/verification/onlook-editor/results.json
   ```
4. **Per-scenario evidence requirements:** every scenario marked `passed` must have:
   - A non-empty screenshot at `results/<NN>-<slug>.png`
   - At least one DOM-level assertion in `assertions[]` that returns true
   - An ISO timestamp in `verified_at`

The validate command for a Phase R/H/Q implementation task therefore has three layers:

```bash
cd .trees/<task-id>-<slug>
# Layer 1: type + unit
bun run typecheck && bun test <task-specific-unit-tests>
# Layer 2: scenario walked by the agent via Chrome MCP (manual step inside the agent prompt)
#          — agent updates results.json after walking the scenario
# Layer 3: orchestrator state check
jq -e '.scenarios["<scenario-id>"].state == "passed"' apps/web/client/verification/onlook-editor/results.json
```

**Tasks where layer 2 is the only feasible gate** are explicitly marked **`mcp-only`** in the table — those must wait for `TR0.4` (Chrome MCP scenario harness) before they can be claimed.

#### Scenario spec layout

`TR0.4` lands the harness:

```
apps/web/client/verification/onlook-editor/scenarios/
├── lib/
│   ├── README.md                        ← how to write a new scenario
│   ├── results-schema.md                ← results.json shape
│   ├── chrome-mcp-walk.md               ← canonical Chrome MCP step list
│   ├── auth-helper.md                   ← DEV MODE sign-in steps
│   └── seed-helper.md                   ← idempotent test data seed
├── 06-real-bundle.md                    ← Phase R Wave 3 scenario
├── 07-edit-rebundle.md                  ← Phase R Wave 4 scenario
├── 08-builder-source-push.md            ← Phase H Wave 4 scenario
├── 09-builder-bundle-fetch.md           ← Phase H Wave 4 scenario
├── 10-relay-manifest.md                 ← Phase H Wave 5 scenario
├── 11-qr-modal.md                       ← Phase Q Wave 4 scenario
├── 12-hermes-magic-header.md            ← Phase Q Wave 4 scenario
├── 13-edit-rebuilds-bundle.md           ← Phase Q Wave 4 scenario
└── 14-expo-go-manual.md                 ← Phase H5 manual phone test (always dead-letter until human marks passed)
```

Each scenario file follows this template (also lands in `lib/README.md`):

```markdown
# Scenario NN: <title>

## Pre-conditions
- <test data state>
- <env state — dev server up, ports, etc.>

## Steps
1. `mcp__chrome-devtools__list_pages`
2. `mcp__chrome-devtools__new_page` url=<...> isolatedContext=verify-onlook
3. `mcp__chrome-devtools__navigate_page` url=<...> timeout=120000
4. `mcp__chrome-devtools__evaluate_script` function=`async () => { ... }` → expect { ... }
5. `mcp__chrome-devtools__take_screenshot` filePath=apps/web/client/verification/onlook-editor/results/NN-<slug>.png

## Assertions
- A1: <DOM check + expected value>
- A2: <network check + expected value>

## Pass criteria
- All assertions return their expected values
- Screenshot file is non-empty
- No uncaught console errors after step 3 except for known-issues list

## results.json update
After walking, the agent writes:
{
  "scenarios": {
    "NN": {
      "state": "passed" | "failed",
      "screenshot": "results/NN-<slug>.png",
      "assertions": [
        { "id": "A1", "passed": true, "actual": "...", "expected": "..." },
        ...
      ],
      "verified_at": "<iso timestamp>",
      "verified_by": "agent <task-id>"
    }
  }
}
```

#### Re-runnability

The scenario specs are idempotent: every pre-condition uses the seed script, every step is named explicitly, every assertion is concrete. An agent picking up the same scenario in a future session reproduces the same evidence.

### Dev server lifecycle

Tasks that need a dev server use `scripts/start-verify-server.sh` (created by `TR0.5`). This script:
- Starts `next dev --port 3001` from the worktree's `apps/web/client/`
- Sets `NEXT_IGNORE_INCORRECT_LOCKFILE=1` (works around the stale `package-lock.json` in the repo root — see issue note below)
- **Does NOT use `--turbo`** (FOUND-03 from the parent queue's first verification run — turbo OOMs on long sessions)
- Polls `http://127.0.0.1:3001/` until 200, then exits 0
- Tails its log to `/tmp/onlook-verify-${TASK_ID}.log`

Per worktree, agents must use a unique port. The orchestrator allocates: `3001 + (task index % 8)` so 8 concurrent agents use 3001–3008.

### Local Worker dev lifecycle

Tasks that need `cf-esm-builder` or `cf-expo-relay` running locally use `scripts/dev-builder.sh` (`TH0.4`) and `scripts/dev-relay.sh` (`TQ1.4`):
- Both wrap `wrangler dev` with port allocation
- Builder runs on port 8788; relay runs on port 8787
- Both poll `/health` until 200 before exiting 0
- Both log to `/tmp/cf-<name>-${TASK_ID}.log`

`scripts/dev-builder.sh` requires a local Docker daemon (Cloudflare Containers run via Wrangler's local Docker integration). If Docker isn't running, the script exits 1 with a clear message — the task is dead-lettered with reason `docker-required`.

### Issue note — Next.js 16 lockfile patch

**Background:** Next.js 16 runs `patchIncorrectLockfile()` on first SWC load. It walks up looking for `package-lock.json`. There's a stale 1.3MB `package-lock.json` in `/Users/ejirohome/Documents/Projects/scry/scry-ide/onlook/` (untracked, from April 2). When found, Next runs `getRegistry()` → `getPkgManager()`, which on this machine falls through to `pnpm --version`; pnpm is shimmed to npm; npm hits ENOWORKSPACES. The dev server still boots (the patch is async + non-fatal) but it spams the log.

**Fix:** Always export `NEXT_IGNORE_INCORRECT_LOCKFILE=1` for dev server starts. `TR0.5` bakes this into the launcher script. Do NOT delete the rogue lockfile from a task — it lives outside any worktree's scope.

### Test data

`TR0.6` lands `scripts/seed-expo-fixture.ts` and updates `verification/onlook-editor/setup.sh` to call it. Every Phase R/H/Q task that needs test data calls the seed script first as part of its validate command. The seed is idempotent — running it any number of times leaves the same Supabase Storage state.

The seeded test branch is the same one Wave 0–J used:
- `PROJECT_ID = 2bff33ae-7334-457e-a69e-93a5d90b18b3`
- `BRANCH_ID  = fcebdee5-1010-4147-9748-823a27dc36a3`
- `USER_EMAIL = support@onlook.com`

After `TR0.6` lands, the bucket key `expo-projects/${PROJECT_ID}/${BRANCH_ID}/` contains a real Expo project tree (not the imperative-DOM hack).

---

## Phase R — Real bundle rendering in canvas iframe

### Wave R0 — Foundation (SEQUENTIAL, 1 agent)

These tasks must land in order and merge before any R1+ task is claimed.

| ID | Title | Files | Validate |
|---|---|---|---|
| **TR0.1** | Document the bugs uncovered during manual verification (so Wave R1 doesn't lose them) | `plans/expo-browser-status.md` (append a "Phase R bugs" section listing the 5 bugs from §"Wave R1 bug list" below — verbatim, with file:line) | `grep -q "Phase R bugs" plans/expo-browser-status.md` |
| **TR0.2** | Lock the real-Expo fixture file list — write the spec for what `seed-expo-fixture.ts` will produce | `plans/expo-browser-fixture-spec.md` (NEW — lists every file path + content sketch, ~120 lines, references **expo@54** (RN 0.81, React 19.1, Hermes default, New Architecture on), `react-native-web@~0.21`) | `test -f plans/expo-browser-fixture-spec.md` |
| **TR0.3** | Define `results.json` shape extensions for scenarios 06–14 + DAG | `apps/web/client/verification/onlook-editor/results.json` (add empty `not_yet_verified_in_this_run` entries for 06–14, no other changes); `apps/web/client/verification/onlook-editor/scenarios/lib/results-schema.md` NEW | `bun -e "JSON.parse(require('fs').readFileSync('apps/web/client/verification/onlook-editor/results.json','utf8'))" && test -f apps/web/client/verification/onlook-editor/scenarios/lib/results-schema.md` |
| **TR0.4** | Chrome MCP scenario harness (markdown templates, auth + seed helpers, results.json schema) | `apps/web/client/verification/onlook-editor/scenarios/lib/README.md` NEW; `lib/chrome-mcp-walk.md` NEW; `lib/auth-helper.md` NEW; `lib/seed-helper.md` NEW | `for f in README chrome-mcp-walk auth-helper seed-helper; do test -s apps/web/client/verification/onlook-editor/scenarios/lib/${f}.md; done` |
| **TR0.5** | `scripts/start-verify-server.sh` (idempotent dev server launcher) | `scripts/start-verify-server.sh` NEW (set `-euo pipefail`; `NEXT_IGNORE_INCORRECT_LOCKFILE=1`; no `--turbo`; poll until 200; logs to `/tmp/onlook-verify-${TASK_ID:-default}.log`) | `bash -n scripts/start-verify-server.sh && shellcheck scripts/start-verify-server.sh` |
| **TR0.6** | `scripts/seed-expo-fixture.ts` + update `setup.sh` to call it | `scripts/seed-expo-fixture.ts` NEW (uploads fixture files to Supabase Storage at `expo-projects/${PROJECT_ID}/${BRANCH_ID}/`); `apps/web/client/verification/onlook-editor/setup.sh` MODIFIED (adds `bun run scripts/seed-expo-fixture.ts` step) | `bash apps/web/client/verification/onlook-editor/setup.sh && curl -s -H "Authorization: Bearer $SK" -X POST $LOCAL/storage/v1/object/list/expo-projects -d '{"prefix":"2bff.../fceb.../","limit":100}' \| jq 'length > 1'` |

**Wave R0 merge gate:** all 6 tasks merged, `seed-expo-fixture.ts` produces a real Expo tree on local Supabase, scenario harness compiles, dev launcher works.

---

### Wave R1 — Bug fixes from current verification (PARALLEL, up to 6 concurrent)

Each task is one bug, one or two files, one new test. **All bugs were observed in a real browser session, not inferred** — the file:line evidence is in `TR0.1`'s document.

| ID | Title | Files (max edit scope) | Validate |
|---|---|---|---|
| **TR1.1** | Fix `SupabaseStorageAdapter.toKey('.')` producing literal `${prefix}/.` (returns 0 files) | `packages/code-provider/src/providers/expo-browser/utils/storage.ts` (only the `toKey` private method); `packages/code-provider/src/providers/expo-browser/__tests__/storage.test.ts` (add cases for `'.'`, `''`, `'/'`, `'./foo'`, `'/foo'`) | `bun test packages/code-provider/src/providers/expo-browser/__tests__/storage.test.ts` AND scenario `01a-list-root.md` walked + `jq -e '.scenarios["01a"].state == "passed"' results.json` |
| **TR1.2** | `detectProjectTypeFromProvider` honors `branch.providerType` instead of guessing from root files | `apps/web/client/src/components/store/editor/sandbox/preload-script.ts` (only the `detectProjectTypeFromProvider` function); `apps/web/client/src/components/store/editor/sandbox/__tests__/preload-script.test.ts` (add: providerType=expo_browser → returns `EXPO` even for empty file list) | `bun test apps/web/client/src/components/store/editor/sandbox/__tests__/preload-script.test.ts` AND scenario `01b-project-type-expo.md` walked |
| **TR1.3** | Supabase Storage RLS policy allows authenticated users to write to `expo-projects/${their_project}/...` | `apps/backend/supabase/migrations/<timestamp>_expo_projects_storage_rls.sql` NEW; `packages/db/migrations/0022_expo_projects_storage_rls.sql` NEW (mirror) | `bun run db:push` AND scenario `01c-preload-upload.md` walked (asserts no RLS error in console after navigate) |
| **TR1.4** | `inferPageFromUrl` (FOUND-02) handles relative URLs without crashing | `packages/utility/src/urls.ts` (only the `inferPageFromUrl` function); `packages/utility/__tests__/urls.test.ts` (add cases for `/preview/<branchId>/<frameId>/`, empty string, undefined) | `bun test packages/utility/__tests__/urls.test.ts` |
| **TR1.5** | `attachBrowserMetro` waits for sync engine's first pull to complete before bundling (currently bundles 0 modules because Vfs is empty when `bundle()` is called) | `apps/web/client/src/components/store/editor/sandbox/index.ts` (only the `initializeSyncEngine` and `attachBrowserMetro` methods — `attachBrowserMetro` becomes a no-op until `this.fs.listAll()` length > 0); `apps/web/client/src/components/store/editor/sandbox/__tests__/index.test.ts` (add: with empty Vfs, attachBrowserMetro defers; with populated Vfs, it bundles) | `bun test apps/web/client/src/components/store/editor/sandbox/__tests__/index.test.ts` |
| **TR1.6** | Storage adapter `fromKey` strips trailing slash safely (defensive) | `packages/code-provider/src/providers/expo-browser/utils/storage.ts` (only the `fromKey` method); same `__tests__/storage.test.ts` from TR1.1 (add cases) | `bun test packages/code-provider/src/providers/expo-browser/__tests__/storage.test.ts` |

**Hotspot warning:** TR1.1 and TR1.6 both edit `storage.ts`. Run **sequentially** (TR1.1 then TR1.6), not in parallel. The orchestrator's per-file lock table enforces this — both tasks declare the same file in their "Files" list.

**Wave R1 merge gate:** `bun test packages/code-provider packages/utility apps/web/client/src/components/store/editor/sandbox` is green. Sandbox dev session boots cleanly; `attachBrowserMetro` no longer reports `0 modules` for the seeded fixture. Scenarios 01a/01b/01c marked passed in `results.json`.

---

### Wave R2 — Browser-metro multi-file bundling (PARALLEL, up to 5 concurrent)

The current `BrowserMetro` host class only bundles a single entry file from `vfs.readFile(entry)`. To render a real Expo project, it needs to walk the Vfs, resolve bare imports (`react`, `react-native-web`) via `esm.sh`, and produce an IIFE wrapper that can run inside the SW-served HTML shell.

To stay within "one file, one owner", split the host into sub-modules first.

| ID | Title | Files | Depends | Validate |
|---|---|---|---|---|
| **TR2.0** | Sub-module scaffold — extract `host/index.ts` into `file-walker.ts`, `entry-resolver.ts`, `iife-wrapper.ts`, `bare-import-rewriter.ts` (empty exports) | `packages/browser-metro/src/host/file-walker.ts` NEW; `packages/browser-metro/src/host/entry-resolver.ts` NEW; `packages/browser-metro/src/host/iife-wrapper.ts` NEW; `packages/browser-metro/src/host/bare-import-rewriter.ts` NEW; `packages/browser-metro/src/host/index.ts` MODIFIED (add the 4 imports, no other change) | — | `bun run typecheck` |
| **TR2.1** | `file-walker.ts` — recursively walks `Vfs.listFiles('.')` and returns every `.tsx`/`.ts`/`.js`/`.jsx` file with its content; respects `.gitignore`-like excludes (`node_modules`, `.git`) | `packages/browser-metro/src/host/file-walker.ts`; `packages/browser-metro/src/host/__tests__/file-walker.test.ts` NEW | TR2.0 | `bun test packages/browser-metro/src/host/__tests__/file-walker.test.ts` |
| **TR2.2** | `entry-resolver.ts` — given a Vfs, returns the first existing of `index.tsx`, `App.tsx`, `src/App.tsx`, `src/index.tsx`, throwing a structured error with the candidates if none exist | `packages/browser-metro/src/host/entry-resolver.ts`; `__tests__/entry-resolver.test.ts` NEW | TR2.0 | `bun test packages/browser-metro/src/host/__tests__/entry-resolver.test.ts` |
| **TR2.3** | `bare-import-rewriter.ts` — rewrites bare imports (`react`, `react-native`, `react-native-web`, `expo-*`) to `${esmUrl}/<pkg>?bundle&external=react,react-native-web` so they resolve at runtime via esm.sh; relative imports stay relative; tracks unresolved deps | `packages/browser-metro/src/host/bare-import-rewriter.ts`; `__tests__/bare-import-rewriter.test.ts` NEW | TR2.0 | `bun test packages/browser-metro/src/host/__tests__/bare-import-rewriter.test.ts` |
| **TR2.4** | `iife-wrapper.ts` — wraps the bundled modules map in `(function(){ const modules = {...}; const require = ...; require('App.tsx'); })()`; injects an importmap-style shim for the bare-rewritten URLs | `packages/browser-metro/src/host/iife-wrapper.ts`; `__tests__/iife-wrapper.test.ts` NEW | TR2.0, TR2.3 | `bun test packages/browser-metro/src/host/__tests__/iife-wrapper.test.ts` |
| **TR2.5** | `host/index.ts` wires R2.1–R2.4 into `bundle()`; the bundle now contains every walked file, rewrites bares, wraps in IIFE, publishes via existing `BroadcastChannel` + `postMessage` | `packages/browser-metro/src/host/index.ts` (only the `bundle()` method); `packages/browser-metro/src/__tests__/host.test.ts` (add: 3-file fixture with one bare import → bundled IIFE includes all files + esm.sh URL) | TR2.1, TR2.2, TR2.3, TR2.4 | `bun test packages/browser-metro` |

**Wave R2 merge gate:** `bun test packages/browser-metro` green. The host can take a 3-file in-memory project with bare imports and emit a runnable IIFE.

---

### Wave R3 — SW + iframe runtime updates (SEMI-SERIAL, max 2 concurrent)

| ID | Title | Files | Depends | Validate |
|---|---|---|---|---|
| **TR3.1** | Preview SW caches the latest bundle per branchId and replays it on subsequent navigates (so a hard reload of the iframe still finds the bundle) | `apps/web/client/public/preview-sw.js` (only the `'message'` handler + `fetch` handler) | TR2.5 | scenario `06a-sw-bundle-cache.md` walked |
| **TR3.2** | HTML shell (`htmlShell()` in `preview-sw.js`) injects `<script type="importmap">` before the bundle so bare imports resolve | `apps/web/client/public/preview-sw.js` (only the `htmlShell` function) | TR3.1 (same file — sequential) | scenario `06b-iframe-runtime.md` walked |
| **TR3.3** | Scenario 06 — iframe loads `react-native-web@0.20` UMD from esm.sh and runs the IIFE; DOM contains `App.tsx` text + screenshot | `apps/web/client/verification/onlook-editor/scenarios/06-real-bundle.md` NEW | TR3.2, TR1.5, Wave R0 | `jq -e '.scenarios["06"].state == "passed"' apps/web/client/verification/onlook-editor/results.json` (agent walks the scenario before the orchestrator validates) |

**Wave R3 merge gate:** scenario 06 passes. The canvas iframe shows real `react-native-web` output from the seeded fixture.

---

### Wave R4 — Hot-reload roundtrip (PARALLEL, up to 3 concurrent)

| ID | Title | Files | Depends | Validate |
|---|---|---|---|---|
| **TR4.1** | `BrowserMetro.invalidate()` reads the changed file from Vfs, re-runs bundle, publishes; existing onUpdate subscribers receive the new IIFE | `packages/browser-metro/src/host/index.ts` (only the `invalidate` method); `__tests__/host.test.ts` add invalidate roundtrip | TR2.5 | `bun test packages/browser-metro` |
| **TR4.2** | `CodeFileSystem` watcher → `bundler.invalidate()` on local file changes (already wired via `attachBundler` in `sandbox/index.ts`; this task just adds the test) | `apps/web/client/src/components/store/editor/sandbox/__tests__/index.test.ts` (add a test that simulates a file write via `fs.writeFile` and asserts the bundler emitted a new bundle within 1s) | TR4.1 | `bun test apps/web/client/src/components/store/editor/sandbox/__tests__/index.test.ts` |
| **TR4.3** | Scenario 07 — edit a file in the editor's code panel, assert iframe reflects the new text within 2s | `apps/web/client/verification/onlook-editor/scenarios/07-edit-rebundle.md` NEW | TR4.2, TR3.3 | `jq -e '.scenarios["07"].state == "passed"' results.json` |

**Wave R4 merge gate:** scenario 07 passes. Local edits in the editor reach the iframe within 2 seconds.

---

## Phase H — Hermes bundling for true Expo Go QR

Phase H runs in parallel with Phase R after R0 lands. It produces a Hermes-compatible JS bundle (the binary format Expo Go's Hermes runtime expects) by running real Metro inside a Cloudflare Container, caching the result in R2, and exposing it via `cf-esm-builder`.

**Pre-existing scaffolds (from parent queue Wave F):** `cf-esm-builder/Dockerfile`, `cf-esm-builder/src/worker.ts`, `cf-esm-builder/wrangler.jsonc`, `cf-esm-cache/src/worker.ts`. These were validated only by `wrangler deploy --dry-run`. Phase H makes them actually work.

### Wave H0 — Foundation (SEQUENTIAL, 1 agent)

| ID | Title | Files | Validate |
|---|---|---|---|
| **TH0.1** | Audit `cf-esm-builder` current state — what exists, what's missing for Onlook integration | `plans/expo-browser-builder-audit.md` NEW (~80 lines: routes present, DO methods, Container binding state, R2 binding state, missing pieces, env vars) | `test -f plans/expo-browser-builder-audit.md` |
| **TH0.2** | Lock the source-push protocol (editor → builder): how the editor ships source files to cf-esm-builder | `plans/expo-browser-builder-protocol.md` NEW (HTTP route shapes: `POST /build` accepts `application/x-tar` of project tree; returns `{ buildId }`; `GET /build/:id` returns `{ state: pending\|building\|ready\|failed, bundleHash?, error? }`; `GET /bundle/:hash` serves from R2) | `test -f plans/expo-browser-builder-protocol.md` |
| **TH0.3** | Lock the bundle artifact format (Hermes-compatible) | `plans/expo-browser-bundle-artifact.md` NEW (file: `index.android.bundle` is a real Hermes bytecode file; `assetmap.json`; `sourcemap.json`; deterministic hash key based on input source SHA256) | `test -f plans/expo-browser-bundle-artifact.md` |
| **TH0.4** | `scripts/dev-builder.sh` — convenience launcher for `cf-esm-builder` (port 8788, requires Docker daemon, polls /health, logs to /tmp/cf-esm-builder-${TASK_ID}.log) | `scripts/dev-builder.sh` NEW | `bash -n scripts/dev-builder.sh && shellcheck scripts/dev-builder.sh` |

**Wave H0 merge gate:** all 4 tasks merged. `dev-builder.sh` runs locally (or fails gracefully with Docker-required). Protocol + artifact specs land before any H1+ task starts.

---

### Wave H1 — Container layer (PARALLEL, up to 5 concurrent)

This wave makes the cf-esm-builder Container actually run Metro. The parent queue's TF.1 landed a Dockerfile placeholder; Phase H replaces it with a working image.

| ID | Title | Files | Depends | Validate |
|---|---|---|---|---|
| **TH1.1** | Dockerfile that installs Node 20 + Expo CLI + Metro toolchain + Hermes compiler | `apps/cf-esm-builder/Dockerfile` MODIFIED (full rewrite); `apps/cf-esm-builder/.dockerignore` MODIFIED | TH0.3 | `docker build apps/cf-esm-builder -t cf-esm-builder:test` succeeds; image size ≤ 800MB; smoke `docker run cf-esm-builder:test --version` |
| **TH1.2** | Container entrypoint (`build.sh`) — reads `/input` source tar, runs `expo export:embed --platform android --bundle-output /output/index.android.bundle`, runs `hermes -O -emit-binary -out /output/index.android.bundle.hbc /output/index.android.bundle`, writes `assetmap.json` + `sourcemap.json` | `apps/cf-esm-builder/container/build.sh` NEW; `apps/cf-esm-builder/container/lib/extract-source.sh` NEW; `apps/cf-esm-builder/container/lib/run-metro.sh` NEW | TH0.3, TH1.1 | `bash apps/cf-esm-builder/container/__tests__/smoke.sh` (uses a tiny fixture project, runs build.sh, asserts `index.android.bundle.hbc` exists and starts with the Hermes magic header `0xc6 0x1f 0xbc 0x03`) |
| **TH1.3** | Smallest valid Expo project fixture for the container smoke test | `apps/cf-esm-builder/container/__tests__/fixtures/minimal-expo/App.tsx` NEW; `package.json` NEW; `app.json` NEW; `babel.config.js` NEW; `__tests__/smoke.sh` NEW | TH0.3 | `cd apps/cf-esm-builder/container/__tests__/fixtures/minimal-expo && bunx expo export:embed --platform android --dev false --bundle-output /tmp/test.bundle` succeeds in CI |
| **TH1.4** | `wrangler.jsonc` Container binding — registers the Docker image as a Container instance | `apps/cf-esm-builder/wrangler.jsonc` MODIFIED (only the `containers` block); `apps/cf-esm-builder/.dev.vars.example` NEW | TH1.1 | `cd apps/cf-esm-builder && bunx wrangler deploy --dry-run` |
| **TH1.5** | `apps/cf-esm-builder/container/README.md` — how to build/test/iterate locally | `apps/cf-esm-builder/container/README.md` NEW | — | `test -s apps/cf-esm-builder/container/README.md` |

**Wave H1 merge gate:** `docker build apps/cf-esm-builder` produces a working image; smoke fixture bundles successfully end-to-end inside the container; Hermes magic header verified on the output.

---

### Wave H2 — Worker layer (PARALLEL, up to 5 concurrent)

These tasks make the cf-esm-builder Worker actually accept source uploads, kick off Container builds, and serve bundles from R2.

| ID | Title | Files | Depends | Validate |
|---|---|---|---|---|
| **TH2.0** | Sub-module scaffold — split `worker.ts` into `routes/build.ts`, `routes/bundle.ts`, `routes/health.ts`, `lib/r2.ts`, `lib/hash.ts`, `do/build-session.ts` (empty exports) | All NEW under `apps/cf-esm-builder/src/`; `worker.ts` MODIFIED (only adds the imports) | TH0.2 | `cd apps/cf-esm-builder && bun run typecheck` |
| **TH2.1** | `routes/build.ts` — `POST /build` accepts `application/x-tar` body, computes deterministic hash of input, checks R2 for existing bundle, otherwise enqueues a Container session | `apps/cf-esm-builder/src/routes/build.ts`; `__tests__/routes/build.test.ts` NEW (uses miniflare or vitest-pool-workers) | TH2.0, TH0.2 | `cd apps/cf-esm-builder && bun test src/routes/__tests__/build.test.ts` |
| **TH2.2** | `do/build-session.ts` — Durable Object that owns one Container instance, streams stdin/stdout, returns bundle bytes on success | `apps/cf-esm-builder/src/do/build-session.ts`; `__tests__/do/build-session.test.ts` NEW | TH2.0, TH1.4 | `cd apps/cf-esm-builder && bun test src/do/__tests__/build-session.test.ts` |
| **TH2.3** | `routes/bundle.ts` — `GET /bundle/:hash` reads from R2, returns the Hermes bundle with `application/javascript` + `cache-control: public, max-age=31536000, immutable` | `apps/cf-esm-builder/src/routes/bundle.ts`; `__tests__/routes/bundle.test.ts` NEW | TH2.0 | `cd apps/cf-esm-builder && bun test src/routes/__tests__/bundle.test.ts` |
| **TH2.4** | `routes/health.ts` — `GET /health` returns `{ ok: true, version: <pkg version>, container: <ready\|missing> }` | `apps/cf-esm-builder/src/routes/health.ts`; `__tests__/routes/health.test.ts` NEW | TH2.0 | `cd apps/cf-esm-builder && bun test src/routes/__tests__/health.test.ts` |
| **TH2.5** | `lib/hash.ts` + `lib/r2.ts` — deterministic SHA256 over a sorted source tree, R2 read/write helpers | `apps/cf-esm-builder/src/lib/hash.ts`; `apps/cf-esm-builder/src/lib/r2.ts`; `__tests__/lib/*.test.ts` NEW | TH2.0 | `cd apps/cf-esm-builder && bun test src/lib/__tests__/` |
| **TH2.6** | `worker.ts` wires routes + DO into a Hono router | `apps/cf-esm-builder/src/worker.ts` (only the router definition); `__tests__/worker.test.ts` NEW | TH2.1, TH2.2, TH2.3, TH2.4, TH2.5 | `cd apps/cf-esm-builder && bun test` |

**Wave H2 merge gate:** `cd apps/cf-esm-builder && bun test && bunx wrangler deploy --dry-run` clean. Local `dev-builder.sh` accepts a curl `POST /build` with a tar body and returns a bundle hash.

---

### Wave H3 — cf-esm-cache (PARALLEL, up to 3 concurrent)

The cache worker fronts cf-esm-builder with a stale-while-revalidate R2 cache so repeat phone refreshes don't re-build.

| ID | Title | Files | Depends | Validate |
|---|---|---|---|---|
| **TH3.1** | `cf-esm-cache/src/worker.ts` — stale-while-revalidate router that proxies `GET /bundle/:hash` from cf-esm-builder, caches in R2, serves from cache on hit | `apps/cf-esm-cache/src/worker.ts` MODIFIED (full rewrite); `__tests__/worker.test.ts` NEW | TH2.6 | `cd apps/cf-esm-cache && bun test && bunx wrangler deploy --dry-run` |
| **TH3.2** | `cf-esm-cache` invalidation API — `POST /invalidate` removes a hash from cache | `apps/cf-esm-cache/src/routes/invalidate.ts` NEW; `__tests__/routes/invalidate.test.ts` NEW | TH3.1 | `cd apps/cf-esm-cache && bun test src/routes/__tests__/invalidate.test.ts` |
| **TH3.3** | `cf-esm-cache` wrangler config — R2 binding to the same bucket as cf-esm-builder | `apps/cf-esm-cache/wrangler.jsonc` MODIFIED | TH3.1 | `cd apps/cf-esm-cache && bunx wrangler deploy --dry-run` |

**Wave H3 merge gate:** cache worker proxies and caches builder bundles end-to-end against the local builder dev server.

---

### Wave H4 — Editor → builder push (PARALLEL, up to 5 concurrent)

These tasks land the editor-side code that ships source from the local CodeFileSystem to cf-esm-builder via HTTP. All NEW files in `apps/web/client/src/services/expo-builder/` — no file conflicts.

| ID | Title | Files | Depends | Validate |
|---|---|---|---|---|
| **TH4.1** | `services/expo-builder/types.ts` — re-exports the protocol from `cf-esm-builder/src/routes/build.ts` (relative workspace import) | `apps/web/client/src/services/expo-builder/types.ts` NEW | TH2.1 | `bun run typecheck` |
| **TH4.2** | `services/expo-builder/source-tar.ts` — walks `CodeFileSystem`, creates a deterministic tar buffer of all `.tsx`/`.ts`/`.js`/`.jsx`/`package.json`/`app.json`/`babel.config.js` files | `apps/web/client/src/services/expo-builder/source-tar.ts` NEW; `__tests__/source-tar.test.ts` NEW | — | `bun test apps/web/client/src/services/expo-builder/__tests__/source-tar.test.ts` |
| **TH4.3** | `services/expo-builder/client.ts` — HTTP client (`postSource`, `getStatus`, `getBundleUrl`); polls every 500ms with exponential backoff | `apps/web/client/src/services/expo-builder/client.ts` NEW; `__tests__/client.test.ts` NEW (uses `msw`) | TH4.1 | `bun test apps/web/client/src/services/expo-builder/__tests__/client.test.ts` |
| **TH4.4** | `services/expo-builder/build-orchestrator.ts` — combines `source-tar` + `client` + invalidates Vfs subscription on file change | `apps/web/client/src/services/expo-builder/build-orchestrator.ts` NEW; `__tests__/build-orchestrator.test.ts` NEW | TH4.2, TH4.3 | `bun test apps/web/client/src/services/expo-builder/__tests__/build-orchestrator.test.ts` |
| **TH4.5** | `services/expo-builder/index.ts` — public re-exports | `apps/web/client/src/services/expo-builder/index.ts` NEW | TH4.1, TH4.2, TH4.3, TH4.4 | `bun run typecheck` |

**Wave H4 merge gate:** `bun test apps/web/client/src/services/expo-builder` green.

---

### Wave H5 — End-to-end Hermes (PARALLEL, up to 3 concurrent)

| ID | Title | Files | Depends | Validate |
|---|---|---|---|---|
| **TH5.1** | Scenario 08 — editor source-tar reaches cf-esm-builder, builder responds with hash | `apps/web/client/verification/onlook-editor/scenarios/08-builder-source-push.md` NEW | TH4.5, TH2.6, TR0.6 | `jq -e '.scenarios["08"].state == "passed"' results.json` |
| **TH5.2** | Scenario 09 — `GET /bundle/:hash` from cf-esm-cache returns a Hermes-magic-header bundle | `apps/web/client/verification/onlook-editor/scenarios/09-builder-bundle-fetch.md` NEW | TH5.1, TH3.1 | `jq -e '.scenarios["09"].state == "passed"' results.json` |
| **TH5.3** | Scenario 12 — Hermes magic header check (`0xc6 0x1f 0xbc 0x03`) on the bundle URL | `apps/web/client/verification/onlook-editor/scenarios/12-hermes-magic-header.md` NEW | TH5.2 | `jq -e '.scenarios["12"].state == "passed"' results.json` |

**Wave H5 merge gate:** scenarios 08, 09, 12 pass. The end-to-end Editor → Builder → Cache → Hermes-bundle path works locally.

---

### Wave H6 — Manual phone validation (DEAD-LETTERED BY DEFAULT)

| ID | Title | Files | Depends | Validate |
|---|---|---|---|---|
| **TH6.1** | Scenario 14 — manual scan of QR with real Expo Go on a phone, document what works/breaks | `apps/web/client/verification/onlook-editor/scenarios/14-expo-go-manual.md` NEW (with explicit "this scenario must be marked passed by a human, not an agent" note) | Phase Q complete | task starts as `dead_lettered` with reason `human-only`; only a human can mark it `passed` in the orchestrator's task table |

---

## Phase Q — QR code UI consuming Hermes bundles

Phase Q can start as soon as **TH0.2** (the builder protocol spec) lands. The UI work is independent of H1–H4; it only needs the protocol to be defined to write its types. Phase Q's e2e scenarios (Wave Q4) gate on Phase H Wave H5.

### Wave Q0 — Foundation (SEQUENTIAL, 1 agent)

| ID | Title | Files | Validate |
|---|---|---|---|
| **TQ0.1** | Audit `cf-expo-relay` current state — what exists from parent queue Wave F, what needs to change to serve Hermes manifests | `plans/expo-browser-relay-audit.md` NEW (~80 lines: routes present, DO methods, missing pieces) | `test -f plans/expo-browser-relay-audit.md` |
| **TQ0.2** | Lock the Expo Go manifest format — must match `https://docs.expo.dev/versions/latest/sdk/updates/#manifest` for Expo Go to fetch and run the bundle | `plans/expo-browser-relay-manifest.md` NEW (~80 lines: full example JSON with `launchAsset.url` pointing at cf-esm-cache, required fields, what the relay must compute, what the editor sends) | `test -f plans/expo-browser-relay-manifest.md` |
| **TQ0.3** | `scripts/dev-relay.sh` — convenience launcher (port 8787, polls /health) | `scripts/dev-relay.sh` NEW | `bash -n scripts/dev-relay.sh && shellcheck scripts/dev-relay.sh` |

---

### Wave Q1 — cf-expo-relay updates (PARALLEL, up to 4 concurrent)

The relay's manifest endpoint now points at the cf-esm-cache bundle URL instead of an in-browser-preview URL.

| ID | Title | Files | Depends | Validate |
|---|---|---|---|---|
| **TQ1.1** | `cf-expo-relay/src/manifest-builder.ts` — builds an Expo Go manifest given a `bundleHash` and `assetMap` from cf-esm-builder | `apps/cf-expo-relay/src/manifest-builder.ts` NEW; `__tests__/manifest-builder.test.ts` NEW | TQ0.2 | `cd apps/cf-expo-relay && bun test src/__tests__/manifest-builder.test.ts` |
| **TQ1.2** | `cf-expo-relay/src/routes/manifest.ts` — `GET /manifest/:bundleHash` returns the Expo manifest JSON pointing at `https://cf-esm-cache.<env>.workers.dev/bundle/:hash` | `apps/cf-expo-relay/src/routes/manifest.ts` NEW; `__tests__/routes/manifest.test.ts` NEW | TQ1.1 | `cd apps/cf-expo-relay && bun test src/routes/__tests__/manifest.test.ts` |
| **TQ1.3** | `cf-expo-relay/wrangler.jsonc` — service binding to `cf-esm-cache` (so the relay can compute the bundle URL with the correct domain) | `apps/cf-expo-relay/wrangler.jsonc` MODIFIED | — | `cd apps/cf-expo-relay && bunx wrangler deploy --dry-run` |
| **TQ1.4** | `cf-expo-relay/src/worker.ts` — wires the new manifest route into the existing Hono router | `apps/cf-expo-relay/src/worker.ts` (only the route registration) | TQ1.2 | `cd apps/cf-expo-relay && bun test` |

**Wave Q1 merge gate:** `cd apps/cf-expo-relay && bun test && bunx wrangler deploy --dry-run` green. Local relay returns a valid Expo manifest for a known bundle hash.

---

### Wave Q2 — Editor service layer (PARALLEL, up to 5 concurrent)

| ID | Title | Files | Depends | Validate |
|---|---|---|---|---|
| **TQ2.0** | `package.json` — add `qrcode` dep | `apps/web/client/package.json` (only the `dependencies` block — add `"qrcode": "^1.5.4"`) | — | `bun install && bun run typecheck` |
| **TQ2.1** | `services/expo-relay/types.ts` — re-exports the manifest types from `cf-expo-relay` | `apps/web/client/src/services/expo-relay/types.ts` NEW | TQ1.1 | `bun run typecheck` |
| **TQ2.2** | `services/expo-relay/manifest-url.ts` — given a bundleHash, builds the public manifest URL `https://<relay-host>/manifest/<hash>` | `apps/web/client/src/services/expo-relay/manifest-url.ts` NEW; `__tests__/manifest-url.test.ts` NEW | TQ2.1 | `bun test apps/web/client/src/services/expo-relay/__tests__/manifest-url.test.ts` |
| **TQ2.3** | `services/expo-relay/qr.ts` — wraps `qrcode` for SVG render with brand colors, takes a manifest URL string | `apps/web/client/src/services/expo-relay/qr.ts` NEW; `__tests__/qr.test.ts` NEW | TQ2.0 | `bun test apps/web/client/src/services/expo-relay/__tests__/qr.test.ts` |
| **TQ2.4** | `services/expo-relay/index.ts` — public re-exports | `apps/web/client/src/services/expo-relay/index.ts` NEW | TQ2.1, TQ2.2, TQ2.3 | `bun run typecheck` |

**Wave Q2 merge gate:** `bun test apps/web/client/src/services/expo-relay` green.

---

### Wave Q3 — Editor UI (SEMI-SERIAL, max 4 concurrent)

| ID | Title | Files | Depends | Validate |
|---|---|---|---|---|
| **TQ3.1** | `components/ui/qr-modal/index.tsx` — modal: takes `{ status, manifestUrl, qrSvg, error? }`; renders QR + URL + copy + status text | `apps/web/client/src/components/ui/qr-modal/index.tsx` NEW; `__tests__/qr-modal.test.tsx` NEW | TQ2.3 | `bun test apps/web/client/src/components/ui/qr-modal` |
| **TQ3.2** | `hooks/use-preview-on-device.tsx` — orchestrates: `build-orchestrator.postSource` → poll `getStatus` → `manifest-url.build(hash)` → `qr.render(url)` → expose `{ status, manifestUrl, qrSvg, error, open, close }` | `apps/web/client/src/hooks/use-preview-on-device.tsx` NEW; `__tests__/use-preview-on-device.test.tsx` NEW | TH4.5, TQ2.4 | `bun test apps/web/client/src/hooks/__tests__/use-preview-on-device.test.tsx` |
| **TQ3.3** | `components/.../preview-on-device-button.tsx` — NEW button only (does NOT yet wire into the toolbar) | `apps/web/client/src/app/project/[id]/_components/top-bar/preview-on-device-button.tsx` NEW; `__tests__/preview-on-device-button.test.tsx` NEW | TQ3.1, TQ3.2 | `bun test apps/web/client/src/app/project/[id]/_components/top-bar/__tests__/preview-on-device-button.test.tsx` |
| **TQ3.4** | Wire button into top-bar — owns the top-bar file alone | `apps/web/client/src/app/project/[id]/_components/top-bar/index.tsx` (only the JSX where the button slots in — single insertion point) | TQ3.3 | `bun test apps/web/client/src/app/project/[id]/_components/top-bar/__tests__/index.test.tsx` AND scenario `11-qr-modal.md` walked |

**Wave Q3 merge gate:** scenario 11 passes. The button is visible in the editor for ExpoBrowser branches; clicking it triggers a build, displays a modal with a QR code rendered from the local relay.

---

### Wave Q4 — End-to-end QR flow (PARALLEL, up to 3 concurrent)

| ID | Title | Files | Depends | Validate |
|---|---|---|---|---|
| **TQ4.1** | Scenario 10 — manifest URL fetched from local relay returns valid Expo manifest with `launchAsset.url` pointing at the local cf-esm-cache | `apps/web/client/verification/onlook-editor/scenarios/10-relay-manifest.md` NEW | TQ3.4, TQ1.4, TH5.2 | `jq -e '.scenarios["10"].state == "passed"' results.json` |
| **TQ4.2** | Scenario 13 — edit a file, assert a new bundleHash is generated within 5s and the QR refreshes to point at the new manifest | `apps/web/client/verification/onlook-editor/scenarios/13-edit-rebuilds-bundle.md` NEW | TQ3.4, TR4.3 | `jq -e '.scenarios["13"].state == "passed"' results.json` |

**Wave Q4 merge gate:** scenarios 10, 13 pass. The full editor → builder → cache → relay → QR flow works locally end-to-end. Phone-side validation is `TH6.1` (manual, dead-lettered until human marks).

---

## Phase Z — Verification suite refresh + integration (SEQUENTIAL, 1 coordinator agent)

After Phases R + H + Q all merge, one agent runs Phase Z to refresh the human-readable verification artifacts.

| ID | Title | Files | Validate |
|---|---|---|---|
| **TZ.1** | `verification/onlook-editor/results.json` — flip scenarios 06–13 from `not_yet_verified_in_this_run` to `passed`, copy proof paths | `apps/web/client/verification/onlook-editor/results.json` | `jq '[.scenarios | to_entries[] | select(.key | test("^(06\|07\|08\|09\|10\|11\|12\|13)$")) | .value.state == "passed"] | all' apps/web/client/verification/onlook-editor/results.json` returns `true` |
| **TZ.2** | `verification/onlook-editor/reference/` — copy fresh PNGs from `results/` to `reference/` for scenarios 06–13 | `apps/web/client/verification/onlook-editor/reference/06-real-bundle.png` … through `13-edit-rebuilds-bundle.png` | `for n in 06 07 08 09 10 11 12 13; do test -s apps/web/client/verification/onlook-editor/reference/${n}-*.png; done` |
| **TZ.3** | `verification/onlook-editor/README.md` — add scenarios 06–14 to the table; document manual phone test caveat for scenario 14 | `apps/web/client/verification/onlook-editor/README.md` | `grep -q "scenario 14" apps/web/client/verification/onlook-editor/README.md` |
| **TZ.4** | Full lint + typecheck + unit test sweep on `feat/expo-browser-provider` | — | `bun run lint && bun run typecheck && bun test` |
| **TZ.5** | Full Chrome MCP scenario sweep via the `verify-with-browser` skill — agent walks every scenario 01–13 and confirms results.json shows all `passed` | — | `jq -e '[.scenarios | to_entries[] | .value.state == "passed"] | all' apps/web/client/verification/onlook-editor/results.json` |
| **TZ.6** | Open PR `feat/expo-browser-provider` → `main` (manual confirmation required from human before this runs — orchestrator dead-letters this task by default until a human marks it `ready`) | — | `gh pr view --json state` returns `OPEN` |

---

## Dependency DAG (compact)

```
                          Wave R0 (TR0.1 → TR0.2 → TR0.3 → TR0.4 → TR0.5 → TR0.6)
                                                  │
                ┌─────────────────────────────────┼─────────────────────────────────┐
                │                                 │                                 │
                ▼                                 ▼                                 ▼
        Wave R1 (TR1.1→TR1.6,           Wave H0 (TH0.1 → TH0.2 → TH0.3 → TH0.4)   Wave Q0 (TQ0.1 → TQ0.2 → TQ0.3)
                  TR1.2/3/4/5)                    │                                 │
                │                                 ▼                                 ▼
                ▼                       Wave H1 (TH1.1/2/3/4/5)            Wave Q1 (TQ1.1 → TQ1.2/4, TQ1.3)
        Wave R2 (TR2.0 → TR2.1/2/3/4 → TR2.5)     │                                 │
                │                                 ▼                                 │
                ▼                       Wave H2 (TH2.0 → TH2.1/2/3/4/5 → TH2.6)     │
        Wave R3 (TR3.1 → TR3.2 → TR3.3)           │                                 │
                │                                 ▼                                 │
                ▼                       Wave H3 (TH3.1 → TH3.2/3)                   │
        Wave R4 (TR4.1 → TR4.2 → TR4.3)           │                                 │
                                                  ▼                                 │
                                        Wave H4 (TH4.1 → TH4.2/3 → TH4.4 → TH4.5)   │
                                                  │                                 │
                                                  ▼                                 ▼
                                        Wave H5 (TH5.1 → TH5.2 → TH5.3)   Wave Q2 (TQ2.0 → TQ2.1 → TQ2.2/3 → TQ2.4)
                                                  │                                 │
                                                  └─────────────────┬───────────────┘
                                                                    │
                                                                    ▼
                                                            Wave Q3 (TQ3.1 || TQ3.2 → TQ3.3 → TQ3.4)
                                                                    │
                                                                    ▼
                                                            Wave Q4 (TQ4.1, TQ4.2 — parallel)
                                                                    │
                                                                    ▼
                                                            Phase Z (TZ.1 → TZ.2 → TZ.3 → TZ.4 → TZ.5 → TZ.6)
                                                                    │
                                                                    ▼
                                                            Wave H6 (TH6.1 — human only)
```

**Total task count:** 6 (R0) + 6 (R1) + 6 (R2) + 3 (R3) + 3 (R4) + 4 (H0) + 5 (H1) + 7 (H2) + 3 (H3) + 5 (H4) + 3 (H5) + 1 (H6) + 3 (Q0) + 4 (Q1) + 5 (Q2) + 4 (Q3) + 2 (Q4) + 6 (Z) = **76 tasks**.

With 8-agent concurrency, the wall-clock critical path is roughly:

- **Sequential foundations:** R0 (6) → R1 (1, then 5 parallel) → R2 (1 scaffold then 4 parallel then 1 wire) → R3 (3) → R4 (3) ≈ ~14 sequential merges on the R pipeline
- **H pipeline:** H0 (4) → H1 (5 parallel) → H2 (7, mostly parallel) → H3 (3) → H4 (5, mostly parallel) → H5 (3) ≈ ~11 sequential merges
- **Q pipeline:** Q0 (3) → Q1 (4 parallel) → Q2 (5 parallel) → Q3 (4) → Q4 (2) ≈ ~10 sequential merges, gated on H4/H5

R, H, Q all run in parallel after their respective Wave 0s. Realistic critical path: **~16 sequential merges**, with 8-wide fan-out in between.

---

## Wave R1 bug list (verbatim — referenced by TR0.1)

These are the bugs uncovered during the manual browser-MCP verification run that was in flight when this queue was written. Each one was reproduced in a real browser session with the editor pointed at the seeded test branch.

1. **Bug R1.1 — Empty file list at root.** `SupabaseStorageAdapter.toKey('.')` produces `${prefix}/.` which Supabase Storage's `list` endpoint treats as a literal directory called "." and returns `[]`. Confirmed by direct curl: `prefix="2bff.../fceb.../."` → `[]`, `prefix="2bff.../fceb..."` → `[App.tsx]`. File: `packages/code-provider/src/providers/expo-browser/utils/storage.ts:115-119`.

2. **Bug R1.2 — Wrong project type detection.** `detectProjectTypeFromProvider` lists root files via the provider, gets `[]` (because of bug R1.1), and falls through to default `nextjs`. Even after R1.1 is fixed, the function should consult `branch.providerType` first — that's the source of truth. File: `apps/web/client/src/components/store/editor/sandbox/preload-script.ts`. Console evidence: `[PreloadScript] detectProjectTypeFromProvider: initial detection: nextjs` for an `expo_browser` branch.

3. **Bug R1.3 — RLS blocks browser-side preload-script upload.** The browser-side Supabase client uses the user's JWT, and the storage policy on `expo-projects` doesn't allow inserts under arbitrary project paths. Console evidence: `[PreloadScript] Failed to copy preload script: Error: storage.upload failed for 2bff33ae-.../fcebdee5-.../public/onlook-preload-script.js: new row violates row-level security policy`.

4. **Bug R1.4 — `inferPageFromUrl` crashes on relative URLs.** FOUND-02 from the parent queue's first verification run. The function calls `new URL(url)` without a base, which throws on `/preview/<branchId>/<frameId>/`. File: `packages/utility/src/urls.ts:74`.

5. **Bug R1.5 — `attachBrowserMetro` bundles 0 modules.** Console evidence: `[browser-metro] bundled 0 modules in 124ms (entry: App.tsx)` followed by `[browser-metro] runtime error: Error: Module not found: App.tsx`. Root cause: `attachBrowserMetro` is called immediately after `sync.start()` returns, but `sync.start()` resolves before its initial `pullFromSandbox()` finishes populating the local Vfs. The bundler reads from an empty Vfs. Fix: gate `attachBrowserMetro` on `this.fs.listAll().length > 0` OR await the sync's first pull.

These five bugs become Wave R1 tasks TR1.1–TR1.5 verbatim. TR1.6 is a defensive cleanup added during decomposition.

---

## Per-task agent prompt template (delta from parent)

Use the parent queue's agent prompt template, with these additions:

```
Phase R/H/Q context:
- Source plan:        plans/expo-browser-implementation.md
- Parent queue:       plans/expo-browser-task-queue.md (your conventions section)
- This queue:         plans/expo-browser-e2e-task-queue.md (your row + the bug list + the validation gate section)
- Status:             plans/expo-browser-status.md (Phase R bugs section, if reading R1 bugs)

Validation environment:
- Dev server:         scripts/start-verify-server.sh (uses NEXT_IGNORE_INCORRECT_LOCKFILE=1, no --turbo)
- Local builder:      scripts/dev-builder.sh (port 8788, requires Docker)
- Local relay:        scripts/dev-relay.sh (port 8787)
- Test data seed:     bash apps/web/client/verification/onlook-editor/setup.sh (idempotent)
- Test branch:        2bff33ae-7334-457e-a69e-93a5d90b18b3
- Test user:          support@onlook.com (DEV MODE button on /login)

E2E gate via Chrome MCP (NOT Playwright):
- Read the scenario markdown at apps/web/client/verification/onlook-editor/scenarios/<NN>-<slug>.md
- Walk it via your mcp__chrome-devtools__* tools (use the verify-with-browser skill)
- Capture screenshots to apps/web/client/verification/onlook-editor/results/<NN>-<slug>.png
- Update apps/web/client/verification/onlook-editor/results.json:
    scenarios.<NN>.state = "passed" | "failed"
    scenarios.<NN>.assertions = [{ id, passed, actual, expected }, ...]
    scenarios.<NN>.verified_at = "<iso timestamp>"
    scenarios.<NN>.verified_by = "agent <task-id>"
- Run the orchestrator's gate:
    jq -e '.scenarios["<NN>"].state == "passed"' apps/web/client/verification/onlook-editor/results.json
- If the gate fails, debug, fix the underlying code, re-walk the scenario.

NEVER fake a passing assertion. NEVER mark a scenario passed without a real screenshot.
"NOT YET VERIFIED IN BROWSER" is the honest answer when something can't be walked.
```

---

## Failure handling (delta from parent)

Inherit the parent queue's per-task retry policy (3 attempts → dead-letter), per-merge integration check (revert on fail), and hotspot file lock table.

**Phase H specific:** Tasks in Wave H1, H2, H3 require Docker daemon + Wrangler. If Docker isn't running on the orchestrator's host, these tasks dead-letter immediately with reason `docker-required`. The orchestrator should pre-flight check `docker info` before dispatching H1–H3.

**Phase Q specific:** Wave Q4 scenarios depend on a running cf-esm-builder + cf-expo-relay locally. The agent's `validate` step boots both via `dev-builder.sh` + `dev-relay.sh` before walking the Chrome MCP scenario, then tears them down on completion. Port collisions across concurrent Q4 agents are prevented by the orchestrator's port allocator.

**Manual gates:** TH6.1 (real phone test) and TZ.6 (open PR) are explicitly dead-lettered until a human marks them `ready` in the orchestrator. The orchestrator must surface them in a "needs-human" queue, not silently retry them.

---

## Open questions before dispatching

1. **Docker daemon availability on the orchestrator host.** Wave H1–H3 require local Docker. Confirm before dispatching. If Docker isn't available locally, an alternative is to push Wave H1–H3 to a CI runner with Docker — that needs orchestrator-side wiring.
2. **Cloudflare Containers local emulation.** Wrangler's local Container support is recent and may not perfectly mirror production behavior. TH1.4 should include a note that `wrangler dev` Container support requires a specific Wrangler version (≥ 3.x with `--experimental-container` if applicable). Check before TH1.4 starts.
3. **Hermes compiler binary in the Container image.** The Hermes binary ships with `expo` via `react-native` but the path varies by Expo SDK. TH1.1 must pin **Expo SDK 54** (matches the fixture spec — RN 0.81, React 19.1, Hermes-default, New Architecture on by default). Bundle format is stable across patches within the SDK 54 line; the Dockerfile should pin to a specific `expo@54.x.y` to keep CI reproducible. Note: SDK 54 is the first SDK where the precompiled `react-native` C++ artifacts ship as the default — relevant for the Container build because it removes the need to build native deps from source inside the Docker image, cutting cold-build time substantially.
4. **`cf-esm-cache` R2 bucket name.** Phase H assumes a single R2 bucket shared between cf-esm-builder (writes) and cf-esm-cache (reads/writes for cache). The wrangler bindings in TH1.4, TH3.3, TQ1.3 must agree on the bucket name. Add a `plans/expo-browser-r2-buckets.md` reference doc as part of TH0.1 if not already documented.
5. **TLS for local cf-expo-relay.** Expo Go on a phone won't fetch a manifest over HTTP unless the host is on the same LAN and Expo Go is in dev mode. The local dev relay should use `wrangler dev --local --ip 0.0.0.0` so the phone can reach it. TQ0.3's launcher script must surface the LAN IP for the QR code to use.
6. **`react-native-web` peer of esm.sh URL** (Phase R only — Phase H uses the real RN runtime in Hermes). Worth a 15-minute spike before Wave R2 starts. If esm.sh's `react-native-web` doesn't ESM cleanly, the rewriter falls back to a CDN-pinned UMD URL pattern.
7. **Lockfile patch workaround scope.** `NEXT_IGNORE_INCORRECT_LOCKFILE=1` is a per-shell env var. It needs to be in every dev server start, every CI runner, and the `verify-with-browser` skill's documented workflow. TR0.5 puts it in the launcher script — make sure CI mirrors it.

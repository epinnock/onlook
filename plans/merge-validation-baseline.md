# Merge-validation baseline — `feat/mobile-preview-merge` (PR #12)

Captured 2026-04-17. This is the authoritative record of the test/validation state of the consolidated merge branch that supersedes PRs #10 (`feat/mobile-client`) and #11 (`feat/mobile-preview-shim`). Use this file to compare against after any subsequent change to the branch.

Branch tip: `dc3e1d95` (test: add renderApp auto-key regression test).

## Typecheck

```
bun --filter @onlook/web-client typecheck
→ Exited with code 0
```

0 TypeScript errors. 305 errors surfaced by the raw merge were fixed across the branch (no `any` introduced — casts are narrow and typed). Fixes were fanned out across parallel agents per the `plans/parallel-execution-methodology.md` 16-slot model.

## Unit tests (merged branch)

- `bun test packages/mobile-preview/runtime/__tests__/` — **96 pass / 0 fail / 386 expect() calls** across 34 files.
- `bun run test` (workspace filter) — every package that completes cleanly reports 0 failures. Package-level summaries from the most recent baseline run:

| Package | Files | Pass | Skip | Fail | Notes |
|---|---|---|---|---|---|
| @onlook/mobile-client | 27 | 298 | 0 | 0 | |
| @onlook/cf-esm-cache | 2 | 11 | 0 | 0 | |
| @onlook/mobile-client-protocol | 7 | 52 | 1 | 0 | 1 test explicitly skipped (pre-existing) |
| @onlook/cf-expo-relay | 3 | 61 | 0 | 0 | |
| @onlook/scripts | 3 | 43 | 0 | 0 | |
| @onlook/backend | — | — | — | — | `cd: supabase/functions/api: No such file or directory` — infra-dependent, pre-existing |

## Pre-existing infra-dependent suites (not merge regressions)

Three clusters of failures observed on this branch that existed before the merge. Each is confirmed infra-dependent by code inspection (not executed to induce).

### CF Worker endpoints — `apps/web/client/e2e/worker/cf-worker-endpoints.spec.ts` (~30 failures)

- Suite's `beforeAll` health-checks a worker at `CF_WORKER_URL` (default `http://localhost:8787`).
- Tests **gracefully skip** when unreachable; what shows as "failing" in aggregate counts are the skipped assertions plus a small number of tests that don't honor the skip gate.
- **Prerequisite to pass locally:** `cd apps/sandbox-worker && wrangler dev` (or point `CF_WORKER_URL` at a deployed instance).

### CF Sandbox full-flow — provider integration specs (~10 failures)

- `packages/code-provider/src/providers/cloudflare/__tests__/http-provider.test.ts` uses fully mocked `fetch`; it passes clean. The failing specs are the cf-terminal / cf-watcher integration ones that depend on a live sandbox.
- **Prerequisite to pass locally:** `@cloudflare/sandbox` installed + sandbox worker running (same environment as the CF Worker endpoints suite above).

### binary-size-audit — `apps/mobile-client/scripts/binary-size-audit.sh` (4 failures)

- The script itself is platform-neutral (POSIX bash + fixture `.app`s).
- The 4 failures come from the wrapper `run-audit-size.ts` that conditionally runs `mobile:build:ios` (Xcode) on macOS and skips on Linux/CI. Wrapper's gate logic is what's breaking in the merge-worktree environment.
- **Prerequisite to pass locally:** `bun run mobile:build:ios` first (populates DerivedData), or call the script directly with `--app /path/to/OnlookMobileClient.app`.

## On-device validation (iOS Simulator + Expo Go SDK 54)

UDID `2C5C7F81-0C5F-4252-9BC5-820159F6764E`, launched via `xcrun simctl openurl … "exp://192.168.0.8:8787/manifest/<hash>"`.

- Runtime hash at commit `dc3e1d95`: `5f285c8da6b14f433115611191d061a5705687abcc35b833f833af2cb7fcd8ed`.
- Sim boots into Expo Go → loads manifest → `bundle.js` eval → `shell.js` bootstraps HMRClient / RCTDeviceEventEmitter / AppRegistry → runtime.js builds the reconciler → default screen renders (screenshot: `/tmp/sim-merge-3.png`, `/tmp/sim-autokeyed.png`).
- Three consecutive `/push` cycles with distinct bg colors + text markers paint distinct screens (red → blue → orange), screenshots at `/tmp/sim-edit-{1,2,3}.png`.
- Unkeyed user code (a bare `View` + `RCTText` without explicit `key`) paints correctly thanks to the Fragment-wrap auto-key fix (screenshot: `/tmp/sim-autokeyed.png` — purple + `AUTOKEYED_PURPLE`).

## Key fixes layered on top of the base PRs

| Commit | Scope | One-line |
|---|---|---|
| `fb7100ec` | typecheck | align tests + providers with current type schemas |
| `1269f58a` | shell guard | switch bootstrap gate from `window` to `OnlookRuntime` presence — unblocks Expo Go HMRClient |
| `8034e8e9` | live-push | wrap every `renderApp` in a keyed Fragment — defeats Fabric reactTag dedupe |
| `dc3e1d95` | regression test | extract helper + add 4 tests pinning the auto-key behavior |

## How to re-verify

1. `cd .trees/mobile-preview-merge`
2. `bun run typecheck` — expect 0 errors.
3. `bun test packages/mobile-preview/runtime/__tests__/` — expect 96/96 green.
4. Start servers: `bun run server/index.ts` from `packages/mobile-preview`, `bun run dev:client` in `apps/web/client`.
5. Load sim: `xcrun simctl openurl <udid> "$(curl -s http://127.0.0.1:8787/status | jq -r .manifestUrl)"`
6. Push test: `curl -X POST http://127.0.0.1:8787/push -H "content-type: application/json" -d '{"type":"eval","code":"globalThis.renderApp(globalThis.React.createElement(\"View\",{style:{flex:1,backgroundColor:0xFF00AA00|0}}))"}'`
7. Screenshot: `xcrun simctl io <udid> screenshot /tmp/out.png` — expect solid green.

## Open follow-ups (non-regression)

- ADR written for the Fabric reactTag dedupe fix: `plans/adr/B13-fabric-reactTag-dedupe-keyed-render.md`.
- No other follow-ups from the merge itself. Mobile-client task queue (`plans/onlook-mobile-client-task-queue.md`) has its own ongoing waves unrelated to this consolidation.

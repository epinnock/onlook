# Test-failure audit — 2026-04-20 (feat/two-tier-bundle)

**Status: RESOLVED 2026-04-23.** All 46 failures in the 4 buckets below are
now either green or gracefully-skipped in `cd apps/web/client && bun run test`.
See "Resolution" section at the bottom for the commit trail. The rest of this
doc is kept as historical record of the pre-resolution state so a reader can
follow the narrative.

**Original purpose.** `bun test` at the repo root reports 46 distinct failing describes (a few sub-tests expand to a 64-failure count in the full run). None of them are regressions from the two-tier pipeline work landing on this branch — the failures all pre-exist the validation changes in this session. This doc categorizes them so the maintainer can triage before merge.

**Total.** 46 distinct failing `describe > test` rows across 4 buckets:

| Bucket | Count | Root cause | Proposed treatment |
|---|---|---|---|
| `CF Worker Endpoints` | 30 | Tests make live HTTP calls to a Cloudflare Worker that isn't running in the test process. | Skip in local `bun test`; run in a CI job that spins up wrangler dev first. |
| `CF Sandbox Full Flow` | 10 | Same as above — CF sandbox container must be live. | Same. |
| `binary-size-audit.sh` | 4 | Shell-script test that runs against a native iOS app binary in `apps/mobile-client/ios/build/…`. No local iOS build exists. | Gate on presence of the build artifact. |
| `MCP App Utils` | 2 | Real bug in `resolveUiResourceUri` — returns `https://mcp.example.com/form` instead of `https://mcp.example.com/_mcp/ui/widget/form`. | Fix-forward; independent of this branch. |

## Bucket details

### CF Worker Endpoints (30)

Files: `apps/web/client/e2e/worker/cf-worker-endpoints.spec.ts` and likely an accompanying `bun test` spec (these surface under both runners).

Examples:
- `GET /health returns status ok with a timestamp`
- `POST /sandbox/create returns sandboxId and ready flag`
- `POST /sandbox/exec returns stdout, stderr, exitCode, success`
- … (27 more, all POST /sandbox/* variants + 404/CORS/OPTIONS assertions)

Pre-existing state: these tests require `CLOUDFLARE_SANDBOX_WORKER_URL` pointing at a reachable worker. In `bun test` context with no worker, every HTTP call throws and each test fails identically.

Safe to ignore during local validation. Recommend tagging with `test.skip(!process.env.CLOUDFLARE_SANDBOX_WORKER_URL, …)` so a bare `bun test` returns green on developer machines.

### CF Sandbox Full Flow (10)

File: `apps/web/client/e2e/flows/cf-full-flow.spec.ts` (or equivalent). Same root cause as above — the suite depends on a live sandbox; without one, every step fails.

Recommend the same env-gated `test.skip` treatment.

### binary-size-audit.sh (4)

File: likely `apps/mobile-client/scripts/binary-size-audit.sh` tests. They run a real shell script against an iOS app binary that only exists after `mobile:build:ios`.

Recommend: skip when the artifact path doesn't exist.

### MCP App Utils (2)

File: `apps/web/client/src/app/project/[id]/_components/right-panel/chat-tab/code-display/__tests__/mcp-app-utils.test.ts`.

Failure: `resolveUiResourceUri` produces the wrong URL — missing the `/_mcp/ui/widget/` path segment. Stack:

```
Expected: "https://mcp.example.com/_mcp/ui/widget/form"
Received: "https://mcp.example.com/form"
```

This is a real bug but it's orthogonal to the two-tier pipeline; fixing it here would blur the diff. Punt to its own task.

## What's NOT in this audit

- **The 1 regression I caused and fixed in this session**: `apps/mobile-client/src/__tests__/full-pipeline.integration.test.ts` was asserting `{ ok: true, sessionId }` but the QrMountResult now also carries `relay`. Fixed by updating the assertion.
- **Workers-pipeline Playwright specs**: 40 pass + 2 opt-in-skipped, 0 fail.
- **Unit suites I touched**: 296 pass across 55 files, 0 fail.

## Verification command set

For a maintainer to reproduce this snapshot:

```bash
bun test 2>&1 | grep "^(fail)" | sort -u | wc -l   # → 46
bun test packages/base-bundle-builder packages/browser-bundler apps/cf-expo-relay apps/mobile-client/src/flow apps/mobile-client/src/relay apps/web/client/src/services/expo-relay  # → all green
bunx playwright test apps/web/client/e2e/workers-pipeline/  # → 42 pass + 2 skip
```

## Resolution — 2026-04-23

All 4 buckets closed in commit `002a5574` + follow-ups:

- **CF Worker Endpoints (30) and CF Sandbox Full Flow (10).**
  `isWorkerRunning` / `beforeAll` probes strengthened to verify a real
  sandbox route (`POST /sandbox/create`) responds 2xx in addition to
  `/health`. Previously a stray HTTP server (another worktree's wrangler,
  a dev static server, etc.) answering `/health` would make
  `workerAvailable=true` and then every sandbox call would 404, producing
  the 40 failures. Now the probe is additive so non-sandbox servers can't
  trick the skip logic. Both suites skip cleanly when a real sandbox
  worker isn't reachable; they only run when one is.

- **MCP App Utils (2).** Commit `1ca2e19a` deliberately changed
  `resolveUiResourceUri` from `{base}/_mcp/ui/{path}` to
  `{origin}/{widgetPath}` (widget HTML served directly from the MCP
  server's origin per the current spec); the test expectations weren't
  updated at the time. Tests aligned to the live semantics plus an
  origin-stripping case covering the `{mcpServerUrl}/mcp` path prefix
  the new implementation discards.

- **binary-size-audit.sh (4).** Surfaces only in the mobile-client's
  `bun run test`; the path was already gated on the presence of
  `apps/mobile-client/ios/build/…`. As of 2026-04-23 all 8 tests in
  `scripts/__tests__/binary-size-audit.sh.test.ts` pass on a fresh
  worktree (the gate fires when the build artifact is absent).

- **`bun test` scoping.** Added `"test": "bun test test src"` to
  `apps/web/client/package.json` so `bun run test` excludes the
  Playwright `.spec.ts` files under `e2e/` (which were blowing up with
  "Playwright Test did not expect test.describe() to be called here").
  E2E Playwright runs are still driven through `bun run test:e2e`.

**Verification after resolution:**

```bash
cd apps/web/client && bun run test      # 548 pass / 0 fail (54 files)
cd apps/web/client && bun run typecheck  # 0 errors
bun test packages/                       # 1771 pass / 2 skip / 0 fail
```

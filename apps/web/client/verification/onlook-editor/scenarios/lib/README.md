# `scenarios/` — Chrome MCP scenario specs

This directory holds the markdown specs for every end-to-end scenario walked
by an agent against the Onlook editor + ExpoBrowser provider. Each spec is a
self-contained recipe: pre-conditions, step-by-step Chrome MCP calls, DOM
assertions, and a screenshot path.

The Chrome MCP gate cannot be invoked from a shell command — it lives inside
the agent's tool surface (`mcp__chrome-devtools__*`). So every scenario in
here is **executed by an agent reading the markdown and walking it itself**,
not by a test runner.

## Where the pieces live

```
apps/web/client/verification/onlook-editor/
├── scenarios/
│   ├── lib/
│   │   ├── README.md              ← you are here
│   │   ├── results-schema.md      ← shape of results.json
│   │   ├── chrome-mcp-walk.md     ← canonical Chrome MCP step list + gotchas
│   │   ├── auth-helper.md         ← DEV MODE sign-in steps
│   │   └── seed-helper.md         ← idempotent test data seed
│   ├── 06-real-bundle.md          ← Phase R Wave 3 scenario (TR3.3)
│   ├── 07-edit-rebundle.md        ← Phase R Wave 4 scenario
│   ├── 08-builder-source-push.md  ← Phase H Wave 4 scenario
│   ├── 09-builder-bundle-fetch.md ← Phase H Wave 4 scenario
│   ├── 10-relay-manifest.md       ← Phase H Wave 5 scenario
│   ├── 11-qr-modal.md             ← Phase Q Wave 4 scenario
│   ├── 12-hermes-magic-header.md  ← Phase Q Wave 4 scenario
│   ├── 13-edit-rebuilds-bundle.md ← Phase Q Wave 4 scenario
│   └── 14-expo-go-manual.md       ← Phase H5 manual phone test (dead-letter)
├── results.json                    ← canonical pass/fail map (committed)
├── results/                        ← gitignored — output of latest run
│   └── <NN>-<slug>.png             ← screenshots, one per scenario
└── reference/                      ← committed baseline screenshots
```

## Naming convention

Every scenario file MUST be named `<NN>-<short-slug>.md` where:

- `<NN>` is a two-digit (or two-character with letter suffix) id matching the
  key in `results.json#scenarios` — e.g. `06`, `07`, `01a`, `01b`.
- `<short-slug>` is kebab-case, ≤4 words, descriptive — e.g. `real-bundle`,
  `edit-rebundle`, `qr-modal`, `hermes-magic-header`.

Example: `06-real-bundle.md` → keyed as `"06"` in `results.json`, screenshot
written to `results/06-real-bundle.png`.

The `<NN>` prefix is the **stable identifier**. The slug is human help; if
you need to rename a slug, the `<NN>` and `results.json` key stay the same so
no other agent loses its reference.

## Standard scenario template

Copy-paste this template when you create a new `<NN>-<slug>.md`. Every section
heading is required so that future agents and the orchestrator can parse it.

````markdown
# Scenario NN: <one-line title — must match results.json#scenarios.<NN>.title>

> **Queue task:** TRX.Y (the task id from `plans/expo-browser-e2e-task-queue.md`
> that produces this scenario)
> **Wave:** R3 / H4 / Q4 / etc.

## Pre-conditions

- Local Supabase running (`docker ps | grep supabase_db_onlook-web`)
- Test data seeded — see `lib/seed-helper.md`
- Dev server up on `http://127.0.0.1:3001` — see `lib/chrome-mcp-walk.md` §0
- Signed in as the DEV MODE user — see `lib/auth-helper.md`
- Any extra fixture state (e.g. for scenario 06: the bucket key
  `expo-projects/${PROJECT_ID}/${BRANCH_ID}/App.tsx` exists)

## Steps

1. `mcp__chrome-devtools__list_pages` — confirm the verify tab is the active
   one; if not, `select_page` to it.
2. `mcp__chrome-devtools__navigate_page`
   - `url`: `http://127.0.0.1:3001/project/2bff33ae-7334-457e-a69e-93a5d90b18b3`
   - `timeout`: `120000`
3. `mcp__chrome-devtools__evaluate_script`
   - `function`: `async () => ({ href: window.location.href })`
   - **Confirm** the navigation actually landed on `/project/...`, not a
     redirect to `/login` or `/see-a-demo`.
4. Wait 3s for the canvas iframe to mount.
5. `mcp__chrome-devtools__take_snapshot` — get element uids for the iframe.
6. `mcp__chrome-devtools__evaluate_script` — run the assertion JS for A1, A2, …
7. `mcp__chrome-devtools__list_console_messages` — confirm no uncaught errors
   beyond the known-issues list.
8. `mcp__chrome-devtools__take_screenshot`
   - `filePath`: `apps/web/client/verification/onlook-editor/results/NN-<slug>.png`

## Assertions

| ID | Description | Expected |
|---|---|---|
| A1 | `document.querySelector('iframe').src` matches `${origin}/preview/<branchId>/<frameId>/` | `"http://127.0.0.1:3001/preview/.../.../"` |
| A2 | iframe innerText (read via postMessage to the SW shell) contains `"Hello from App.tsx"` | `true` |
| A3 | `fetch('/preview/<branchId>/<frameId>/bundle.js').then(r => r.status)` returns `200` | `200` |

(Each row maps 1:1 to an entry in `results.json#scenarios.<NN>.assertions`.)

## Pass criteria

- Every assertion in the table above returns its expected value
- The screenshot at `results/NN-<slug>.png` is non-empty (≥ 1 KB on disk)
- No uncaught console errors after step 2 except items in the known-issues
  list below
- `window.location.pathname` after step 2 is exactly the route this scenario
  targets

## Known issues (allowed console noise)

- `Failed to load resource: net::ERR_BLOCKED_BY_CLIENT` for analytics endpoints
  (the verify-onlook isolated context blocks them by default)
- React DevTools install hint
- (anything else that is not the assertion under test)

## results.json update

After walking, the agent writes:

```json
{
  "scenarios": {
    "NN": {
      "state": "passed",
      "screenshot": "results/NN-<slug>.png",
      "assertions": [
        { "id": "A1", "passed": true, "actual": "<observed>", "expected": "<spec>" },
        { "id": "A2", "passed": true, "actual": "<observed>", "expected": "<spec>" },
        { "id": "A3", "passed": true, "actual": 200, "expected": 200 }
      ],
      "verified_at": "2026-04-08T14:22:05.123Z",
      "verified_by": "agent TRX.Y",
      "title": "<same as the H1 title>",
      "queue_task": "TRX.Y"
    }
  }
}
```

If any assertion fails, set `state` to `"failed"`, populate `actual` with the
real observation, and file an entry in
`results.json#issues_found_during_verification`. **Never** mark a scenario
`"passed"` without a real screenshot on disk.
````

## Worked example — minimal "smoke test" scenario

This is the smallest plausible scenario. Use it as a starting point if you're
writing the first spec for a new wave and want to make sure the harness
itself works before adding real assertions.

````markdown
# Scenario 99: Smoke test — login page renders

> **Queue task:** (harness self-test)
> **Wave:** —

## Pre-conditions

- Dev server up on `http://127.0.0.1:3001`

## Steps

1. `mcp__chrome-devtools__new_page`
   - `url`: `about:blank`
   - `isolatedContext`: `verify-onlook`
2. `mcp__chrome-devtools__navigate_page`
   - `url`: `http://127.0.0.1:3001/login`
   - `timeout`: `120000`
3. `mcp__chrome-devtools__evaluate_script`
   - `function`: `async () => ({ href: window.location.href, title: document.title })`
4. `mcp__chrome-devtools__take_screenshot`
   - `filePath`: `apps/web/client/verification/onlook-editor/results/99-smoke.png`

## Assertions

| ID | Description | Expected |
|---|---|---|
| A1 | `window.location.pathname` after navigate | `"/login"` |
| A2 | `document.title` is non-empty | `length > 0` |

## Pass criteria

- A1 + A2 hold
- Screenshot file is non-empty

## results.json update

```json
{
  "scenarios": {
    "99": {
      "state": "passed",
      "screenshot": "results/99-smoke.png",
      "assertions": [
        { "id": "A1", "passed": true, "actual": "/login", "expected": "/login" },
        { "id": "A2", "passed": true, "actual": "Onlook", "expected": "length > 0" }
      ],
      "verified_at": "<iso>",
      "verified_by": "agent harness-smoke",
      "title": "Smoke test — login page renders",
      "queue_task": "—"
    }
  }
}
```
````

## Required reading before walking any scenario

The four helper docs in this directory are the contract every scenario relies
on. Read them in this order on your first run:

1. **[`results-schema.md`](./results-schema.md)** — exactly what shape your
   `results.json` updates must take. The orchestrator's `jq -e ...` gate fails
   silently if you write the wrong shape, so this is non-negotiable.
2. **[`seed-helper.md`](./seed-helper.md)** — how to seed the test data your
   scenario depends on. Idempotent, safe to re-run.
3. **[`auth-helper.md`](./auth-helper.md)** — how to sign in via the DEV MODE
   button so subsequent navigation lands on `/project/...` instead of
   bouncing to `/login` or `/see-a-demo`.
4. **[`chrome-mcp-walk.md`](./chrome-mcp-walk.md)** — the canonical Chrome MCP
   call sequence + every gotcha learned during Wave 0–J. Read this even if
   you've used Chrome MCP elsewhere; the gotchas list saves hours.

## Don'ts

- **Don't** write a scenario that depends on a Playwright runner. The gate is
  Chrome MCP only — see "Validation gate — Chrome MCP" in
  `plans/expo-browser-e2e-task-queue.md`.
- **Don't** reuse a `<NN>` id from a different scenario. The id is the
  primary key in `results.json`; collisions silently overwrite each other.
- **Don't** include hardcoded absolute paths to a developer's home directory.
  Use `apps/web/client/verification/onlook-editor/results/<NN>-<slug>.png`
  relative to the repo root.
- **Don't** mark a scenario `"passed"` without a real screenshot. The
  orchestrator only checks `state == "passed"`; lying here propagates a
  false-pass into Phase H/Q.
- **Don't** edit `results-schema.md` from a scenario task — it is owned by
  TR0.3.

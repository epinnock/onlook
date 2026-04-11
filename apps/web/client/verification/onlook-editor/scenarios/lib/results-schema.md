# `results.json` schema

Canonical description of the shape of
`apps/web/client/verification/onlook-editor/results.json`. This file is the
pass/fail map the orchestrator reads when gating Phase R/H/Q tasks in
`plans/expo-browser-e2e-task-queue.md`. Every Chrome-MCP scenario walked by an
agent lands its evidence here.

## Top-level keys

| Key | Type | Meaning |
|---|---|---|
| `branch` | `string` | Git branch the run was executed on (e.g. `feat/expo-browser-provider`). |
| `test_run_at` | `string` (ISO-8601) | Wall-clock start of the verification run. Not per-scenario — the overall run. |
| `environment` | `object` | Free-form map of the dev server URL, local Supabase URL, auth mode. Used by agents picking up a partial run to reproduce the env. |
| `test_data` | `object` | Seeded IDs (`user_id`, `project_id`, `branch_id`, `frame_id`) + persisted frame URL. Must match what `apps/web/client/verification/onlook-editor/setup.sh` produces. |
| `scenarios` | `object` | Map keyed by scenario id (`"01_..."`, `"06"`, `"14"`, etc.) → per-scenario result object. See below. |
| `not_yet_verified_in_this_run` | `array<object>` | Scenarios the current run chose to skip, with `reason` + `alternative_evidence`. Not the same as a scenario whose state is `not_yet_verified` — this is for scenarios the run explicitly deferred. |
| `issues_found_during_verification` | `array<object>` | Bugs the agent tripped over while walking the scenarios. Each entry has `id`, `severity`, `fixed`, `description`, `fix`. |
| `summary` | `object` | Roll-up counts (`passed`, `failed`, `not_yet_verified`, `deferred_to_follow_up`, `issues_found`, `issues_fixed_during_run`). |

## Per-scenario shape

Every entry under `scenarios` is one of two shapes depending on whether it
has been walked yet.

### Not-yet-verified (stub) shape

```json
{
  "state": "not_yet_verified",
  "screenshot": null,
  "assertions": [],
  "verified_at": null,
  "verified_by": null,
  "title": "<one-line human summary>",
  "queue_task": "<task id from plans/expo-browser-e2e-task-queue.md, e.g. TR3.3>"
}
```

| Field | Type | Meaning |
|---|---|---|
| `state` | `"not_yet_verified"` | Scenario has a spec but nobody has walked it. |
| `screenshot` | `null` | No evidence yet. Becomes `"results/<NN>-<slug>.png"` after walking. |
| `assertions` | `[]` | Empty. Populated during walk. |
| `verified_at` | `null` | Timestamp gets set when the walk finishes. |
| `verified_by` | `null` | Set to `"agent <task-id>"` when the walk finishes. |
| `title` | `string` | Short human-readable title. Must match the task row in the queue file. |
| `queue_task` | `string` | The `plans/expo-browser-e2e-task-queue.md` task id that produces this scenario (e.g. `TR3.3` for scenario 06). |

### Walked (passed or failed) shape

```json
{
  "state": "passed" | "failed",
  "screenshot": "results/06-real-bundle.png",
  "assertions": [
    { "id": "A1", "passed": true, "actual": "<observed>", "expected": "<spec>", "note": "optional commentary" }
  ],
  "verified_at": "2026-04-08T14:22:05.123Z",
  "verified_by": "agent TR3.3",
  "title": "Real bundle renders App.tsx output in canvas iframe",
  "queue_task": "TR3.3"
}
```

Existing scenarios `01_*..05_*` predate this schema and use a different
legacy shape (`state: "pass"`, plus `wave` + `proof` fields). They are
preserved as-is. New scenarios (`06`..`14`) use the shape above.

## `state` values

| Value | Meaning |
|---|---|
| `not_yet_verified` | Stub — spec exists or is queued, nobody has walked it. Default for 06–14. |
| `passed` | Walked successfully. Every assertion returned its expected value, `screenshot` is a non-empty file on disk, no uncaught console errors beyond the scenario's known-issues list. |
| `failed` | Walked and at least one assertion returned unexpected. Agent must populate `assertions[].actual` with the real observation and file an entry in `issues_found_during_verification`. |
| `dead_lettered` | Walked 3× and could not be made to pass — blocked by an upstream bug or missing fixture. Orchestrator surfaces dead-lettered scenarios in a needs-human queue. |

## Assertion shape

```json
{
  "id": "A1",
  "passed": true,
  "actual": "<what the agent observed>",
  "expected": "<what the scenario spec said>",
  "note": "optional extra context"
}
```

| Field | Type | Meaning |
|---|---|---|
| `id` | `string` | Stable id, `A1`/`A2`/`A3`. Matches the `## Assertions` section in the scenario markdown. |
| `passed` | `boolean` | `true` if `actual === expected` (or the spec-defined equivalence holds). |
| `actual` | `string \| number \| boolean \| object` | Real observation from the Chrome MCP call. |
| `expected` | `string \| number \| boolean \| object` | Value copied verbatim from the scenario spec. |
| `note` | `string` *(optional)* | Commentary — e.g. "matched after 2s retry because the SW had to reinstall". |

## How an agent walks a scenario then updates this file

The authoritative walk flow is in the "Per-task agent prompt template"
section of `plans/expo-browser-e2e-task-queue.md`. Summary:

1. Read the scenario markdown at
   `apps/web/client/verification/onlook-editor/scenarios/<NN>-<slug>.md`.
2. Ensure pre-conditions hold — run
   `bash apps/web/client/verification/onlook-editor/setup.sh` for the seed,
   start the dev server via `scripts/start-verify-server.sh`.
3. Walk the `## Steps` list using `mcp__chrome-devtools__*` tools
   (`list_pages`, `new_page`, `navigate_page`, `evaluate_script`,
   `take_screenshot`, `list_console_messages`, etc.).
4. For each assertion in `## Assertions`, record an entry
   `{ id, passed, actual, expected }` in `scenarios.<NN>.assertions`.
5. Save the screenshot to
   `apps/web/client/verification/onlook-editor/results/<NN>-<slug>.png`
   and set `scenarios.<NN>.screenshot` to that path.
6. Set `scenarios.<NN>.state` to `"passed"` (all assertions passed and
   screenshot non-empty) or `"failed"`, set `verified_at` to the current
   ISO timestamp, and `verified_by` to `"agent <task-id>"`.
7. Run the orchestrator gate:
   ```bash
   jq -e '.scenarios["<NN>"].state == "passed"' \
     apps/web/client/verification/onlook-editor/results.json
   ```
8. On `failed`, the agent debugs the underlying code, re-walks the
   scenario, and does **not** overwrite `verified_at` until the walk
   truly passes. Never mark a scenario `passed` without a real screenshot
   on disk.

## Worked example

```jsonc
{
  "scenarios": {
    // Legacy-shape, already walked and passing (do not touch)
    "01_canvas_loading_browser_preview": {
      "wave": "Wave H §1.1 + §1.3",
      "state": "pass",
      "screenshot": "reference/01-canvas-loading-browser-preview.png",
      "assertions": [
        "iframe.src === 'http://127.0.0.1:3001/preview/<branchId>/<frameId>/'",
        "iframe content includes 'Loading browser preview…'"
      ],
      "proof": "Frame URL routing in canvas/frame/view.tsx ..."
    },

    // New-shape stub, waiting for the TR3.3 agent to walk it
    "06": {
      "state": "not_yet_verified",
      "screenshot": null,
      "assertions": [],
      "verified_at": null,
      "verified_by": null,
      "title": "Real bundle renders App.tsx output in canvas iframe",
      "queue_task": "TR3.3"
    }
  }
}
```

After the TR3.3 agent walks scenario 06, the `"06"` block becomes:

```json
{
  "state": "passed",
  "screenshot": "results/06-real-bundle.png",
  "assertions": [
    {
      "id": "A1",
      "passed": true,
      "actual": "Hello from App.tsx",
      "expected": "Hello from App.tsx"
    },
    {
      "id": "A2",
      "passed": true,
      "actual": 200,
      "expected": 200,
      "note": "GET /preview/<branchId>/<frameId>/bundle.js returned 200 with Content-Type: application/javascript"
    }
  ],
  "verified_at": "2026-04-08T14:22:05.123Z",
  "verified_by": "agent TR3.3",
  "title": "Real bundle renders App.tsx output in canvas iframe",
  "queue_task": "TR3.3"
}
```

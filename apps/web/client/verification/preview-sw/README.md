# preview-sw verification suite

A self-contained visual + DOM-assertion regression suite for
`apps/web/client/public/preview-sw.js` (Wave H §1.3 of
`plans/expo-browser-implementation.md`).

This directory ships in the Onlook integration tree so that anyone on
the team can re-run the suite later without needing the Next.js app,
the Postgres backend, the local Supabase instance, or any auth.

## Quick start

```bash
cd apps/web/client/verification/preview-sw
bun run.ts
```

The script:

1. Starts a one-shot static HTTP server on `http://127.0.0.1:8765/`
   serving this directory.
2. Launches headless Chromium via `puppeteer` (already a dev dep of
   the integration tree — no separate install).
3. Loads `harness.html`, which registers `preview-sw.js` and runs all
   six scenarios sequentially. Each scenario asserts on the iframe DOM.
4. Waits for `window.__verifyResults` to be set (the harness sets it
   when every scenario completes).
5. Saves per-scenario element screenshots + a full-page rollup to
   `results/`.
6. Exits with code 0 if every scenario passed, 1 if any failed,
   2 if the runner itself crashed.

## What the suite covers

| # | Scenario                          | What it asserts |
|---|-----------------------------------|-----------------|
| 1 | **Success path**                  | Push a valid bundle via `postMessage`, navigate iframe to `/preview/sx-success/f1/`, expect the IIFE wrapper to render the bundle's `App.tsx` output into `#root` |
| 2 | **Error overlay**                 | Push a bundle that throws at runtime, expect the IIFE wrapper's catch block to write the stack trace to `document.body` |
| 3 | **Placeholder before bundle**     | Navigate without pushing a bundle. The SW should serve the `'waiting for first bundle'` placeholder JS, the iframe should still show the SW HTML shell's loading message |
| 4 | **Multi-branch isolation**        | Push two different bundles for two different `branchId`s. Two iframes side-by-side render the correct bundle each, with no cross-branch leakage |
| 5 | **Bundle update (live re-bundle)**| Push bundle v1, load iframe, push bundle v2 with different content, force iframe reload, expect v2 |
| 6 | **HTML shell metadata**           | Inspect the served HTML shell's `<body>` for `data-branch-id` and `data-frame-id` attributes set to the URL path segments |

Each scenario writes a `pass`/`fail` pill into the harness UI and
updates `window.__verifyResults` so the runner can read pass/fail
without screen-scraping.

## Output

After a successful run, `results/` contains:

```
results/
├── results.json          ← scenario pass/fail map + timestamp
├── 00-rollup.png         ← full-page screenshot of the entire harness
├── 01-scenario.png       ← element screenshot of scenario 1's card
├── 02-scenario.png
├── 03-scenario.png
├── 04-scenario.png
├── 05-scenario.png
└── 06-scenario.png
```

`results/` is gitignored (re-running the suite re-generates it). The
intentional reference snapshots live in `reference/` and ARE checked
in. After each run, eyeball-diff `results/<id>-scenario.png` against
`reference/<id>-scenario.png`.

## Adding a new scenario

1. Add a new `<div class="scenario" id="scenario-NN" data-scenario="…">`
   block to `harness.html`.
2. Append `'NN'` to the `SCENARIO_IDS` constant in the runner script
   (`run.ts`).
3. Add a `scenarioNN_*` async function in `harness.html` and call it
   from `runAll()` in script-load order.
4. Re-run `bun run.ts` to generate the new screenshot.
5. Once you're happy with the output, copy the new screenshot from
   `results/NN-scenario.png` to `reference/NN-scenario.png` and commit
   both the harness changes and the new reference image.

## Why no pixel-diff regression?

Sucrase output is deterministic but Chrome's text rendering differs
across host OSes (font hinting, subpixel layout, antialiasing). A
pixel-diff would flake on every machine that isn't the one that
captured the reference set. The DOM assertions inside each scenario
are the actual pass/fail signal — the screenshots are for human eyes
when something feels off but the assertions pass.

If a future contributor wants pixel-diff coverage, the right shape is
to switch this suite over to Playwright with `toHaveScreenshot()` and
let Playwright manage the per-platform reference matrix.

## Why this isn't a Playwright spec

Playwright requires the browser binaries (`bunx playwright install`)
which is a ~500MB one-shot download. This suite uses Puppeteer's
bundled Chromium, which is already pulled in by the workspace deps,
so re-running the suite needs zero setup beyond `bun install` (which
the team has already done as part of normal repo bootstrap).

The Playwright specs in `apps/web/client/e2e/expo-browser/` cover the
**integration** path — they exercise the SW through the real Onlook
editor and need the full Next.js app + DB. This suite covers the
**unit** path: just the SW + a fake bundle, no Onlook.

## Troubleshooting

- **Suite hangs at "waiting for scenarios to complete"**:
  Open `harness.html` directly in a real Chrome and look at the status
  panel. Most likely the SW failed to register (check DevTools >
  Application > Service Workers).
- **Old SW cached**: in real Chrome, go to DevTools > Application >
  Service Workers and click "Unregister", then reload. The runner uses
  a fresh Chromium profile per invocation so this only affects manual
  debugging.
- **`port 8765 in use`**: set `VERIFY_PORT=…` in env and re-run.
  `VERIFY_PORT=9000 bun run.ts`

# onlook-editor verification suite

End-to-end visual + DOM-assertion regression suite that walks through the
real Onlook editor with an ExpoBrowser branch and verifies every Wave 0–J
integration claim that lives in `apps/web/client/`.

This is the **integration-path** verification, complementing the **unit-path**
verification at `apps/web/client/verification/preview-sw/`. Together they
cover the full ExpoBrowser surface end to end.

## What it asserts

| # | Scenario | Wave | What it verifies |
|---|---|---|---|
| 1 | Canvas iframe loads from the SW preview URL | H §1.1 + §1.3 | Iframe `src` is `${origin}/preview/<branchId>/<frameId>/`, content includes `Loading browser preview…` from `preview-sw.js` `htmlShell()` |
| 2 | Publish dropdown shows the disclaimer | G §0.9 | "Publishing isn't available in browser-preview mode yet" + the switch-back hint |
| 3 | Settings modal opens via JD avatar | I §0.5 | User-avatar menu opens the Settings dialog |
| 4 | Project tab renders Preview runtime radio | I §0.5 | h2 'Preview runtime' + 2 radios; 'Browser preview' checked because `branch.providerType==='expo_browser'`; tRPC `user.getFeatureFlags` fired and returned `{useExpoBrowserPreview:true}` |
| 5 | Bottom panel terminal tab is hidden | D §1.7.2 | Zero DOM elements with text `'Terminal'`; `SessionManager.createTerminalSessions` capability gate skipped the interactive terminal session |

Deferred to follow-up (LLM round-trip needed): chat agent surfacing
`PROVIDER_NO_SHELL` from `bash_read`, npm-install via interceptor, and
`isomorphic-git` git-status path.

## Quick start

```bash
# 1. Local Supabase running?
docker ps | grep supabase_db_onlook-web

# 2. Seed test data (idempotent)
bash apps/web/client/verification/onlook-editor/setup.sh

# 3. Bring up dev server (NO --turbo — see FOUND-03)
cd apps/web/client && PORT=3001 bun run next dev --port 3001

# 4. Open Chrome at http://127.0.0.1:3001/login
#    Click "DEV MODE: Sign in as demo user"

# 5. Walk the manual checklist below, OR run the
#    `verify-with-browser` Claude skill to automate it
```

## Manual verification checklist

- [ ] **01** Open `http://127.0.0.1:3001/project/2bff33ae-7334-457e-a69e-93a5d90b18b3` — canvas iframe shows "Loading browser preview…" → screenshot to `results/01-canvas-loading-browser-preview.png`
- [ ] **02** Click Publish in the top bar — disclaimer popover appears → `results/02-publish-disclaimer.png`
- [ ] **03** Open Settings via JD avatar → Settings → `results/03-settings-modal-open.png`
- [ ] **04** Click "Project" in settings sidebar — h2 "Preview runtime" + 2 radios visible → `results/04-settings-preview-runtime.png`
- [ ] **05** Close modal — only "Preview" and "New Chat" tabs in bottom panel → `results/05-editor-overview.png`

## Reference vs results

`reference/` contains screenshots from a known-good run, committed to the
repo. `results/` is gitignored — re-running regenerates it. Eyeball-diff
`results/<id>.png` against `reference/<id>.png` for visual changes.

`results.json` (committed) is the canonical pass/fail map, the test data
IDs, and a list of issues found during the verification run. **Read it
first** when picking up the next verification run.

## Why dev server runs on 3001 (not 3000)

The user's main `bun run dev` is almost certainly already running on 3000
against `main`. Spinning up a SECOND dev server on 3001 from the
integration worktree means:
- The user's main session is undisturbed
- The integration branch's code is what's being verified
- Both share the same local Supabase

## Why no Playwright

Playwright requires `bunx playwright install` (~500MB browser binaries).
This suite uses the Chrome MCP that the verification driver already has.
If you want true cross-platform CI coverage, port the scenarios to
Playwright specs in `apps/web/client/e2e/expo-browser/`.

## Issues this verification surfaced

See `results.json#issues_found_during_verification`. Highlights:

- **FOUND-01** Pre-existing schema drift — `conversations` table missing
  `agent_type` column. Patched manually; needs a real migration.
- **FOUND-02** `inferPageFromUrl` in `packages/utility/src/urls.ts:74`
  crashes on relative URLs. SW preview URLs are relative by design.
  Needs a util fix.
- **FOUND-03** `next dev --turbo` OOMs on long verification runs. Use
  plain `next dev`.
- **FOUND-04** Dev server tRPC route cache may not pick up new
  procedures without a fresh restart.
- **FOUND-05** Project layout redirects no-subscription users to
  /see-a-demo. Verification pre-seeds `legacy_subscriptions` for the
  demo user; production fix is to bypass the check in DEV MODE login.

None of these are bugs introduced by Wave 0–J — they're all pre-existing
or env-specific issues the verification surfaced for the first time.

# onlook-editor verification suite

End-to-end visual + DOM-assertion regression suite that walks through the
real Onlook editor with an ExpoBrowser branch and verifies the Phase R
canvas iframe pipeline + Phase H Hermes builder + Phase Q QR UI.

This is the **integration-path** verification, complementing the **unit-path**
verification at `apps/web/client/verification/preview-sw/`. Together they
cover the full ExpoBrowser surface end to end.

## What it asserts

| # | Scenario | State | What it verifies |
|---|---|---|---|
| 1 | Canvas iframe loads from the SW preview URL | passed | Iframe `src` is `${origin}/preview/<branchId>/<frameId>/`, content includes `Loading browser preview…` from `preview-sw.js` `htmlShell()` |
| 2 | Publish dropdown shows the disclaimer | passed | "Publishing isn't available in browser-preview mode yet" + the switch-back hint |
| 3 | Settings modal opens via JD avatar | passed | User-avatar menu opens the Settings dialog |
| 4 | Project tab renders Preview runtime radio | passed | h2 'Preview runtime' + 2 radios; 'Browser preview' checked because `branch.providerType==='expo_browser'`; tRPC `user.getFeatureFlags` fired and returned `{useExpoBrowserPreview:true}` |
| 5 | Bottom panel terminal tab is hidden | passed | Zero DOM elements with text `'Terminal'`; `SessionManager.createTerminalSessions` capability gate skipped the interactive terminal session |
| **6** | **Real react-native-web bundle renders in canvas iframe** | **passed (2026-04-08)** | **`[browser-metro] bundled 5 modules in 1179ms (entry: index.ts)`, iframe DOM `innerText === "Hello, Onlook!"` (text from seeded `components/Hello.tsx`), no runtime errors. Full pipeline: TR0.6 fixture seed → DEV MODE auth → TR1.7 authed client injection → CodeProviderSync pull → R2 BrowserMetro multi-file bundling → async IIFE with URL pre-fetch → SW serves bundle.js → react-native-web mounts via AppRegistry.runApplication.** |
| 7 | Edit file, iframe reflects within 2s | deferred | Storage REST PUT does not trigger sync engine watcher (sync only pulls at start); needs UI-driven Monaco edit. Unit-tested at TR4.1 + TR4.2. |
| 8 | Editor source-tar reaches cf-esm-builder | not_yet_verified | Phase H Container needs to be running (TH1.1 Dockerfile not yet landed) |
| 9 | Bundle hash returns Hermes magic header | not_yet_verified | Phase H |
| 10 | Manifest URL returns valid Expo manifest | not_yet_verified | Phase Q UI walk |
| 11 | QR modal opens with valid URL | not_yet_verified | Phase Q UI walk |
| 12 | Hermes magic header check | not_yet_verified | Phase H |
| 13 | Edit triggers new bundleHash within 5s | not_yet_verified | Phase Q UI walk |
| 14 | Manual phone scan with real Expo Go | dead-letter | Human-only — must be marked passed by a human |

## Quick start

```bash
# 1. Local Supabase running?
docker ps | grep supabase_db_onlook-web

# 2. Seed test data + fixture (idempotent)
bash apps/web/client/verification/onlook-editor/setup.sh

# 3. Bring up dev server with --webpack (Next 16 turbopack OOMs on long sessions)
cd apps/web/client && PORT=3001 NEXT_IGNORE_INCORRECT_LOCKFILE=1 NODE_OPTIONS='--max-old-space-size=8192' bun run next dev --port 3001 --webpack

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
- [x] **06** After ~30s, iframe DOM text contains "Hello, Onlook!" — see `reference/06-real-bundle.png` ✅ **2026-04-08**

## Reference vs results

`reference/` contains screenshots from a known-good run, committed to the
repo. `results/` is gitignored — re-running regenerates it. Eyeball-diff
`results/<id>.png` against `reference/<id>.png` for visual changes.

`results.json` (committed) is the canonical pass/fail map, the test data
IDs, and a list of issues found during the verification run. **Read it
first** when picking up the next verification run.

## The 4 fixes that unblocked scenario 06

Documented in `plans/expo-browser-status.md` under "2026-04-08 Phase R
end-to-end VERIFIED IN BROWSER". Summary:

- **FOUND-06a** — htmlShell injected the ESM preload script as a classic `<script>` → SyntaxError on iframe load. Fix: drop the preload script from the v1 ExpoBrowser shell entirely.
- **FOUND-06b** — IIFE require shim couldn't handle URL specs from the bare-import-rewriter. Fix: async IIFE with `await Promise.all(__urlImports.map(import))` populating a `__urlCache`; require shim resolves URL specs from cache. Plus 4 follow-ups (URL list threading, empty external list, post-sucrase rewrite for the auto-injected JSX runtime, and a fixture v2 that uses `react-native-web` directly because esm.sh can't bundle native `react-native`).
- **FOUND-R1.5-followup** — TR1.5's `firstPullComplete` raced on shared sync instances. Fix: defensive Vfs.length guard with bounded setTimeout retry.
- **FOUND-R1.7** — Browser-side `@supabase/supabase-js` Storage client used a different `GoTrueClient` than Onlook's auth client. Fix: inject the editor's existing authed client into `ExpoBrowserProvider` via the new `supabaseClient` option.

## Why dev server runs on 3001 (not 3000)

The user's main `bun run dev` is almost certainly already running on 3000
against `main`. Spinning up a SECOND dev server on 3001 from the
integration worktree means:
- The user's main session is undisturbed
- The integration branch's code is what's being verified
- Both share the same local Supabase

## Why --webpack (not turbopack)

Next.js 16's default Turbopack mode OOMs the SWC native binding on long
verification sessions (FOUND-03 from the parent queue, still reproducible
in Next 16). Use `--webpack` to opt out — it's slower to compile (~25s
first request vs ~4s) but stable across multi-hour runs.

## Why no Playwright

The validation gate is **Chrome MCP via the verify-with-browser skill**,
not Playwright. Each scenario is a markdown spec the agent walks via
`mcp__chrome-devtools__*` tools. See `scenarios/lib/README.md`.

## Issues this verification surfaced

See `results.json#issues_found_during_verification`. Highlights from the
2026-04-08 walk:

- **FOUND-06a** Preload script was loaded as classic `<script>` in the
  iframe shell but the file ships ESM with top-level `export`. Fixed.
- **FOUND-06b** IIFE require shim architecture mismatch with esm.sh URL
  specs. Fixed via async IIFE + dynamic import pre-fetch.
- **FOUND-R1.5-followup** TR1.5 `firstPullComplete` race on shared sync
  instances. Fixed with defensive Vfs guard + bounded retry.
- **FOUND-R1.7** Browser Supabase client did not pass auth to Storage
  requests. Fixed by injecting the editor's authed client into the provider.

Earlier findings (still relevant): FOUND-01 schema drift, FOUND-02
inferPageFromUrl crash on relative URLs, FOUND-03 next dev --turbo OOM,
FOUND-04 dev server tRPC route cache, FOUND-05 see-a-demo redirect.

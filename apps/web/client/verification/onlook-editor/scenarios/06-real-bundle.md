# Scenario 06: Real bundle renders App.tsx in canvas iframe

> **Queue task:** TR3.3 (Wave R3 of `plans/expo-browser-e2e-task-queue.md`)
> **Wave:** R3

## What it asserts

When the editor opens the seeded Expo project, the `SandboxManager` attaches
`BrowserMetro` to the branch's `CodeFileSystem`, BrowserMetro walks the
seeded fixture (`App.tsx` → `components/Hello.tsx` + bare imports for
`react`, `react-native`, `react-native-web`, `expo-status-bar`), produces an
IIFE bundle, and publishes it to the preview service worker via
`postMessage`/`BroadcastChannel`. The SW then serves the bundle through the
canvas iframe (`/preview/<branchId>/<frameId>/`), which loads
`react-native-web@~0.21` UMD via esm.sh and evaluates the IIFE. The
react-native-web runtime mounts the `App` component, and the iframe DOM
contains the visible `Hello, Onlook!` text from
`components/Hello.tsx`. End-to-end: Vfs → BrowserMetro walker → bare-import
rewriter → IIFE → SW publish → SW fetch handler → iframe `<script>` →
react-native-web mount → DOM text.

## Pre-conditions

- Local Supabase running (`docker ps | grep supabase_db_onlook-web`)
- Test data seeded — run `bash apps/web/client/verification/onlook-editor/setup.sh`
  (idempotent — re-seeds the Expo fixture into Supabase Storage per TR0.6 so
  `expo-projects/2bff33ae-7334-457e-a69e-93a5d90b18b3/fcebdee5-1010-4147-9748-823a27dc36a3/App.tsx`
  and the rest of the seven fixture files exist)
- Dev server up on `http://127.0.0.1:3001` —
  `PORT=3001 TASK_ID=scenario-06 bash scripts/start-verify-server.sh`
- Chrome MCP available (`mcp__chrome-devtools__*` tools in the agent's tool
  surface)
- See `lib/seed-helper.md`, `lib/auth-helper.md`, and `lib/chrome-mcp-walk.md`
  for the canonical pre-flight + walk patterns this scenario follows.

## Steps

1. `mcp__chrome-devtools__list_pages` — confirm whether a `verify-onlook`
   isolated tab is already open. If yes and it's already on `/projects` or
   `/project/...`, `select_page` to it and skip steps 2–4 (the session cookie
   is reusable).
2. `mcp__chrome-devtools__new_page`
   - `url`: `http://127.0.0.1:3001/login`
   - `isolatedContext`: `verify-onlook`
3. `mcp__chrome-devtools__take_snapshot` — find the button whose accessible
   name is `DEV MODE: Sign in as demo user`; note its uid.
4. `mcp__chrome-devtools__click`
   - `uid`: `<DEV MODE button uid from step 3>`
5. `mcp__chrome-devtools__navigate_page`
   - `url`: `http://127.0.0.1:3001/project/2bff33ae-7334-457e-a69e-93a5d90b18b3`
   - `timeout`: `120000`
6. `mcp__chrome-devtools__evaluate_script` — sleep 6 seconds for the SW to
   register, the sync engine to pull the seeded fixture from Storage into the
   in-memory Vfs, and BrowserMetro to publish the first bundle:
   ```js
   async () => { await new Promise(r => setTimeout(r, 6000)); return 'ok'; }
   ```
7. `mcp__chrome-devtools__list_console_messages` — record the console buffer.
   Assert it contains the substrings `[SandboxManager] attachBrowserMetro called`
   and `[browser-metro] bundled` followed by a module count `>= 3`.
8. `mcp__chrome-devtools__evaluate_script` — find the canvas iframe, read its
   `src`, and (if same-origin) read its body innerText:
   ```js
   async () => {
     const iframe = document.querySelector('iframe[src*="/preview/"]');
     if (!iframe) return { found: false };
     const src = iframe.src;
     let innerText = null;
     try {
       innerText = iframe.contentDocument?.body?.innerText?.slice(0, 500) ?? null;
     } catch (e) {
       innerText = `cross-origin: ${e?.message ?? 'unknown'}`;
     }
     return { found: true, src, innerText };
   }
   ```
9. `mcp__chrome-devtools__take_screenshot`
   - `filePath`: `apps/web/client/verification/onlook-editor/results/06-real-bundle.png`
   - `fullPage`: `true`

## Assertions

| ID | Description | Expected |
|---|---|---|
| A1 | Console contains `[browser-metro] bundled <N> modules` with `N >= 3` (App.tsx + Hello.tsx + at least one of `index.ts`/bare-import shim) | `true` |
| A2 | The canvas iframe `src` matches `^http://127\\.0\\.0\\.1:3001/preview/fcebdee5-1010-4147-9748-823a27dc36a3/[^/]+/$` (i.e. `/preview/<branchId>/<frameId>/`) | `true` |
| A3 | Iframe `contentDocument.body.innerText` includes the fixture's visible string `Hello, Onlook!` (rendered by `components/Hello.tsx` from `App.tsx`) | `"Hello, Onlook!"` substring present |
| A4 | Console buffer contains zero lines matching `^\\[browser-metro\\] runtime error` and zero uncaught exceptions other than the known-issues list in `lib/chrome-mcp-walk.md` §G6 | `true` |
| A5 | Screenshot file at `apps/web/client/verification/onlook-editor/results/06-real-bundle.png` is non-empty (`>= 5120` bytes / 5 KB) | `true` |

## Pass criteria

- All five assertions return their expected values
- The screenshot file at `results/06-real-bundle.png` exists on disk and is
  larger than 5 KB
- No uncaught console errors after step 5 (except items in
  `lib/chrome-mcp-walk.md` §G6 known-noise)
- `window.location.pathname` after step 5 is exactly
  `/project/2bff33ae-7334-457e-a69e-93a5d90b18b3` (no redirect to `/login`,
  `/projects`, or `/see-a-demo`)

## Known issues (allowed console noise)

- `Failed to load resource: net::ERR_BLOCKED_BY_CLIENT` for analytics
  endpoints (the verify-onlook isolated context blocks them)
- React DevTools install hint
- `[HMR] connected` chatter from the dev server
- esm.sh fetch warnings about CORS preflight (these are diagnostic, not
  fatal — the actual `react-native-web@~0.21` UMD load succeeds)

## results.json update

After walking, the agent writes the following block under
`scenarios.06` in
`apps/web/client/verification/onlook-editor/results.json`:

```json
{
  "scenarios": {
    "06": {
      "state": "passed",
      "screenshot": "results/06-real-bundle.png",
      "assertions": [
        { "id": "A1", "passed": true, "actual": "[browser-metro] bundled 4 modules", "expected": "[browser-metro] bundled N modules with N >= 3" },
        { "id": "A2", "passed": true, "actual": "http://127.0.0.1:3001/preview/fcebdee5-1010-4147-9748-823a27dc36a3/59008694-b3a6-4f39-8182-af7646f31857/", "expected": "matches /preview/<branchId>/<frameId>/" },
        { "id": "A3", "passed": true, "actual": "Hello, Onlook!", "expected": "innerText includes 'Hello, Onlook!'" },
        { "id": "A4", "passed": true, "actual": "no [browser-metro] runtime error lines", "expected": "no [browser-metro] runtime error lines" },
        { "id": "A5", "passed": true, "actual": 18432, "expected": ">= 5120" }
      ],
      "verified_at": "<ISO-8601 timestamp at walk completion>",
      "verified_by": "agent TR3.3",
      "title": "Real bundle renders App.tsx output in canvas iframe",
      "queue_task": "TR3.3"
    }
  }
}
```

If any assertion fails, set `state` to `"failed"`, populate each
`assertions[].actual` with the real observation, and file an entry under
`results.json#issues_found_during_verification` describing the failure +
suspected fix. Never mark a scenario `"passed"` without a real screenshot
on disk.

## Failure modes

| Symptom | Likely cause | Where to look |
|---|---|---|
| Console shows `[browser-metro] bundled 0 modules` | Vfs is empty — sync engine never pulled the seeded fixture from Supabase Storage. TR1.5 should have fixed this; verify the fix is on the integration branch. | `apps/web/client/src/components/store/editor/sandbox/sync.ts`; check the `[sync]` console logs on initial load; re-run `setup.sh` to confirm Storage has the seven fixture files. |
| iframe DOM has no visible text (innerText empty or only whitespace) | The IIFE failed to evaluate — usually a `SyntaxError` from the SWC/Babel transform, or react-native-web's UMD failed to load. | DevTools → Network tab inside the iframe context for the importmap + esm.sh fetch; console buffer for `Uncaught SyntaxError` with a `bundle.js` source URL; check the bare-import-rewriter (TR2.3) handled `react-native-web` correctly. |
| iframe `src` doesn't match `/preview/<branchId>/<frameId>/` (e.g. is `about:blank` or a stale CSB URL) | SW preview URL routing broken, or the branch row's `provider_type` is not `expo_browser`. | `frame.url` column in DB for branch `fcebdee5-...`; `apps/web/client/src/app/project/[id]/_components/canvas/frame/view.tsx`; re-run `setup.sh` (it sets `provider_type = 'expo_browser'`). |
| Iframe loads but `GET /preview/.../bundle.js` returns 404 | The SW didn't receive a `bundle` message from the page, or the `BroadcastChannel` delivery flaked (see `lib/chrome-mcp-walk.md` §G5). | Console for `[browser-metro] publish` lines; SW console (DevTools → Application → Service Workers → `/preview/`); confirm `registration.active.postMessage(...)` fallback is wired alongside `BroadcastChannel`. |
| `pathname` after step 5 is `/see-a-demo` | `legacy_subscriptions` row missing for `support@onlook.com`. | Re-run `setup.sh` (it inserts the bypass row per FOUND-05); see `lib/auth-helper.md` → "FOUND-05 — the legacy_subscriptions bypass". |

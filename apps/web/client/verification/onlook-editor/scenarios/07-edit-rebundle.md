# Scenario 07: Edit a file in the editor, iframe reflects within 2s

> **Queue task:** TR4.3 (Wave R4 of `plans/expo-browser-e2e-task-queue.md`)
> **Wave:** R4

## What it asserts

With the canvas iframe already rendering the seeded fixture (scenario 06),
opening `components/Hello.tsx` in the editor's code panel and changing the
visible string from `Hello` to `Hello-EDITED` triggers the
`CodeFileSystem` watcher, which calls `BrowserMetro.invalidate(path)`
(TR4.1), which re-walks the changed file from Vfs, re-runs the bundler,
publishes a fresh IIFE to the preview SW, and the canvas iframe reflects
the new text within 2 seconds — all without a full page reload.
End-to-end: editor file write → CodeFileSystem watcher → bundler.invalidate
→ BrowserMetro re-bundle → SW publish → iframe DOM update.

## Pre-conditions

- All pre-conditions from `06-real-bundle.md` (local Supabase, seeded data,
  dev server on `127.0.0.1:3001`, Chrome MCP, signed in via DEV MODE)
- **Scenario 06 must be `passed`** in `results.json` — this scenario assumes
  the initial bundle path works. If 06 is `failed` or `not_yet_verified`,
  walk it first; do not attempt 07 against a known-broken initial bundle.
- The seeded `components/Hello.tsx` from the Expo fixture is present in
  Supabase Storage at
  `expo-projects/2bff33ae-7334-457e-a69e-93a5d90b18b3/fcebdee5-1010-4147-9748-823a27dc36a3/components/Hello.tsx`
  and contains the literal text `Hello` (re-run `setup.sh` to reset if a
  prior walk left `Hello-EDITED` persisted).

## Steps

1. `mcp__chrome-devtools__list_pages` — confirm or open a `verify-onlook`
   tab. If reusable, `select_page` to it; otherwise follow steps 2–5 from
   `06-real-bundle.md` to sign in and navigate to the project.
2. Walk steps 1–8 of `06-real-bundle.md` to land on
   `/project/2bff33ae-7334-457e-a69e-93a5d90b18b3` with a working iframe.
   Confirm the iframe innerText currently includes `Hello, Onlook!` (the
   pre-edit baseline).
3. `mcp__chrome-devtools__take_snapshot` — find the file tree panel and
   locate the entry for `components/Hello.tsx`. Note its uid.
4. `mcp__chrome-devtools__click`
   - `uid`: `<uid of the components/Hello.tsx file-tree row>`
   - This opens the file in the editor's code panel (Monaco / CodeMirror).
5. `mcp__chrome-devtools__evaluate_script` — sleep 1.5s for the editor to
   mount and load the file content:
   ```js
   async () => { await new Promise(r => setTimeout(r, 1500)); return 'ok'; }
   ```
6. `mcp__chrome-devtools__take_snapshot` — find the editor's text input
   surface (Monaco's `textarea[aria-label*="Editor"]` or the equivalent in
   the active editor). Note its uid.
7. `mcp__chrome-devtools__evaluate_script` — apply the text edit by writing
   directly to the in-memory editor model (more reliable than typing keys
   into Monaco for an automated walk):
   ```js
   async () => {
     // Find the editor instance via the global Monaco registry, or via the
     // editor's exposed handle on window.__onlook_editor__ if present.
     // Replace the literal "Hello" in components/Hello.tsx with "Hello-EDITED".
     const w = window;
     const path = 'components/Hello.tsx';
     // Strategy 1: drive the editor store directly
     const engine = w.__onlook_engine__ ?? null;
     if (engine?.code?.writeFile) {
       const current = await engine.code.readFile(path);
       const next = current.replace(/Hello/g, 'Hello-EDITED').replace(/Hello-EDITED-EDITED/g, 'Hello-EDITED');
       await engine.code.writeFile(path, next);
       return { strategy: 'engine.code.writeFile', length: next.length };
     }
     // Strategy 2: drive Monaco directly
     const monaco = w.monaco;
     if (monaco?.editor?.getModels) {
       const model = monaco.editor.getModels().find(m => m.uri.path.endsWith(path));
       if (model) {
         const current = model.getValue();
         const next = current.replace(/Hello/g, 'Hello-EDITED').replace(/Hello-EDITED-EDITED/g, 'Hello-EDITED');
         model.setValue(next);
         return { strategy: 'monaco.model.setValue', length: next.length };
       }
     }
     return { strategy: 'none', error: 'no editor handle found — fall back to type_text' };
   }
   ```
   If the script returns `strategy: 'none'`, fall back to `type_text` /
   `press_key` against the snapshot uid from step 6 to perform the edit
   manually.
8. `mcp__chrome-devtools__evaluate_script` — sleep 3 seconds (the spec
   requires the iframe to update within 2s; the extra 1s is jitter slack):
   ```js
   async () => { await new Promise(r => setTimeout(r, 3000)); return 'ok'; }
   ```
9. `mcp__chrome-devtools__list_console_messages` — record the console
   buffer. Assert it contains a `[browser-metro] invalidate` line for
   `components/Hello.tsx` followed by a `[browser-metro] bundled` line, and
   that the wall-clock delta between the file write (step 7) and the
   second `bundled` line is `< 2000ms`.
10. `mcp__chrome-devtools__evaluate_script` — re-read the iframe innerText
    and confirm the new string is present:
    ```js
    async () => {
      const iframe = document.querySelector('iframe[src*="/preview/"]');
      if (!iframe) return { found: false };
      let innerText = null;
      try {
        innerText = iframe.contentDocument?.body?.innerText?.slice(0, 500) ?? null;
      } catch (e) {
        innerText = `cross-origin: ${e?.message ?? 'unknown'}`;
      }
      return {
        found: true,
        innerText,
        hasEdited: typeof innerText === 'string' && innerText.includes('Hello-EDITED'),
      };
    }
    ```
11. `mcp__chrome-devtools__take_screenshot`
    - `filePath`: `apps/web/client/verification/onlook-editor/results/07-edit-rebundle.png`
    - `fullPage`: `true`

## Assertions

| ID | Description | Expected |
|---|---|---|
| A1 | Console contains a `[browser-metro] invalidate` (or equivalent) line referencing `components/Hello.tsx` *after* the editor write in step 7 | `true` |
| A2 | Console contains a second `[browser-metro] bundled` line whose timestamp is `< 2000ms` after the corresponding `invalidate` line | `true` (delta < 2000ms) |
| A3 | Iframe `contentDocument.body.innerText` after step 8 includes the literal substring `Hello-EDITED` (and no longer just `Hello,` alone — i.e. the new text replaced the old) | `"Hello-EDITED"` substring present |
| A4 | Screenshot file at `apps/web/client/verification/onlook-editor/results/07-edit-rebundle.png` is non-empty (`>= 5120` bytes / 5 KB) | `true` |

## Pass criteria

- All four assertions return their expected values
- The screenshot file at `results/07-edit-rebundle.png` exists on disk and
  is larger than 5 KB
- No uncaught console errors after step 7 (except items in
  `lib/chrome-mcp-walk.md` §G6 known-noise)
- The iframe was **not** fully reloaded — i.e. its `contentWindow` retained
  its identity across the edit (a full reload is acceptable as a v1 fallback
  but the spec preference is in-place re-evaluation; flag a `note` on A3 if
  a reload was observed)

## Known issues (allowed console noise)

- Same as `06-real-bundle.md` — analytics blocks, React DevTools hint,
  HMR chatter, esm.sh CORS preflight diagnostics

## results.json update

After walking, the agent writes the following block under
`scenarios.07` in
`apps/web/client/verification/onlook-editor/results.json`:

```json
{
  "scenarios": {
    "07": {
      "state": "passed",
      "screenshot": "results/07-edit-rebundle.png",
      "assertions": [
        { "id": "A1", "passed": true, "actual": "[browser-metro] invalidate components/Hello.tsx", "expected": "[browser-metro] invalidate line for components/Hello.tsx after editor write" },
        { "id": "A2", "passed": true, "actual": 743, "expected": "delta < 2000ms", "note": "ms between invalidate and the next bundled line" },
        { "id": "A3", "passed": true, "actual": "Hello-EDITED, Onlook!", "expected": "innerText includes 'Hello-EDITED'" },
        { "id": "A4", "passed": true, "actual": 19204, "expected": ">= 5120" }
      ],
      "verified_at": "<ISO-8601 timestamp at walk completion>",
      "verified_by": "agent TR4.3",
      "title": "Edit a file in the editor, iframe reflects within 2s",
      "queue_task": "TR4.3"
    }
  }
}
```

If any assertion fails, set `state` to `"failed"`, populate each
`assertions[].actual` with the real observation, and file an entry under
`results.json#issues_found_during_verification`. Never mark a scenario
`"passed"` without a real screenshot on disk.

After (or before) the walk, **reset the seeded fixture** by re-running
`bash apps/web/client/verification/onlook-editor/setup.sh` so the next
run starts from `Hello` rather than `Hello-EDITED`.

## Failure modes

| Symptom | Likely cause | Where to look |
|---|---|---|
| Edit applied, but no `[browser-metro] invalidate` log appears | The `CodeFileSystem` watcher is not connected to `BrowserMetro.invalidate`. The wiring lives in `attachBundler` inside `sandbox/index.ts`; TR4.2 added the test for this. | `apps/web/client/src/components/store/editor/sandbox/index.ts` (`attachBundler`); confirm `bundler.invalidate(path)` is called from the file-write listener; re-run the unit test `bun test apps/web/client/src/components/store/editor/sandbox/__tests__/index.test.ts`. |
| `invalidate` and `bundled` logs both appear, but iframe innerText is unchanged | The SW didn't replay the new bundle to the iframe — the cache write in `preview-sw.js` either silently failed or the page didn't broadcast the new IIFE. | DevTools → Application → Service Workers → `/preview/` → console for `[preview-sw] cache write <hash>`; check `BroadcastChannel` + `postMessage` fallback (see `lib/chrome-mcp-walk.md` §G5); inspect the SW's cache via `caches.open('preview-bundles').then(c => c.keys())`. |
| Iframe innerText changed but `Hello-EDITED` is wrapped in `Hello-EDITED-EDITED` (double-replace) | The edit script ran twice (once via Strategy 1 and once via Strategy 2). | Defensive `replace(/Hello-EDITED-EDITED/g, 'Hello-EDITED')` in step 7 should catch this; if it didn't, audit which editor handle was actually wired. |
| Iframe text changed, but the iframe was fully reloaded (lost component state) | JSX hot-reload broken — the SW served the new bundle but the page invalidated the existing iframe instead of swapping the script. | Compare `iframe.contentWindow` identity before/after the edit via `evaluate_script`; check whether `preview-sw.js` issues a `clients.claim()` + `Cache.put` flow vs an aggressive `client.navigate(client.url)` reload. |
| Edit didn't even reach the file system (Monaco changed but `engine.code.readFile` returns the old content) | The editor's code panel is decoupled from `CodeFileSystem` — Monaco model changes are local until `save`. | Check whether the editor exposes `writeFile` on edit vs on explicit save; if save-on-edit isn't the default, the walk needs to trigger save via `Cmd+S` (`mcp__chrome-devtools__press_key`). |

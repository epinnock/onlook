# Chrome MCP walk — canonical step list

The exact sequence every scenario in `apps/web/client/verification/onlook-editor/scenarios/`
uses to drive the browser via `mcp__chrome-devtools__*`. Read this once before
your first walk; refer back any time a step misbehaves.

This document is the per-project equivalent of the `verify-with-browser`
skill at `~/.claude/skills/verify-with-browser/SKILL.md`. The skill is the
universal version; this is the Onlook-editor-specific narrowing with the
gotchas surfaced during Wave 0–J + Phase R verification.

## §0. Pre-flight

Before any Chrome MCP call:

1. **Test data seeded.** See `lib/seed-helper.md`. Without the seed, the
   `/project/<id>/...` route bounces to `/projects` because the project row
   doesn't exist yet, and the JD avatar dropdown is empty.
2. **Dev server up.** `TR0.5` lands `scripts/start-verify-server.sh`. Until it
   exists, manually:
   ```bash
   cd apps/web/client && \
     NEXT_IGNORE_INCORRECT_LOCKFILE=1 PORT=3001 \
     bun run next dev --port 3001 \
     > /tmp/onlook-verify.log 2>&1 &
   # poll until 200
   while ! curl -sf -o /dev/null http://127.0.0.1:3001/; do sleep 1; done
   ```
   - **Do not use `--turbo`** — see FOUND-03.
   - **Do not use port 3000** — that's the user's main session. Use 3001+.
3. **Signed in.** See `lib/auth-helper.md`. The DEV MODE button on `/login`
   gets you a real Supabase session for `support@onlook.com` plus the legacy
   subscription bypass.

If any of the above is missing, **stop and fix it before opening Chrome MCP.**
Walking without prerequisites just produces a flake the next agent has to
debug.

## §1. The eight-step walk

Every scenario uses this sequence. Numbers below are the Chrome MCP tool
calls in order.

### 1. `mcp__chrome-devtools__list_pages`

What: enumerates the open Chrome tabs.

Why first: an earlier scenario in the same session may already have a
`verify-onlook` isolated tab open. Reusing it preserves the auth cookie jar
and saves a fresh login round-trip. If you see one with a `/project/...` URL
already, `select_page` to it instead of opening a new one.

```
mcp__chrome-devtools__list_pages
```

Inspect the response. Decide: reuse an existing tab (`select_page`), or open
a new one (step 2).

### 2. `mcp__chrome-devtools__new_page` (only if no reusable tab)

What: opens a fresh tab in an isolated browser context.

Why isolated: the `verify-onlook` context has its own cookie jar, separate
from the user's main browsing. Without isolation, this verification would
sign the user in/out of their real Onlook session every run, which is
disruptive and pollutes their auth state.

```
mcp__chrome-devtools__new_page
  url: about:blank
  isolatedContext: verify-onlook
```

The literal string `verify-onlook` is what the helper docs and parent queue
assume. **Do not change it** without updating every scenario file.

### 3. `mcp__chrome-devtools__navigate_page`

What: navigates the active page to a URL.

```
mcp__chrome-devtools__navigate_page
  url: http://127.0.0.1:3001/project/2bff33ae-7334-457e-a69e-93a5d90b18b3
  timeout: 120000
```

**Critical settings:**

- **`timeout: 120000`** — the default is 10 seconds, which is far too short
  for the first compile of a Next.js route in dev mode. The first navigation
  to a previously-uncompiled route can take 30–90 seconds. Use 120000 (2
  minutes) to be safe; subsequent navigations to the same route are fast.
- **Don't trust the response.** `navigate_page` can return
  `{"status":"Successfully navigated"}` while the page actually got
  server-side-redirected to a different route (e.g. `/login`,
  `/see-a-demo`). **Always confirm `window.location.href` after** with an
  `evaluate_script` call (step 4).

### 4. `mcp__chrome-devtools__take_snapshot`

What: returns the accessibility tree of the current page, including stable
**element uids** for everything clickable.

Why before clicking: `mcp__chrome-devtools__click` takes a uid, not a CSS
selector. The only way to get a uid is `take_snapshot`. Always snapshot
before any click; never try to click by selector or coordinates.

```
mcp__chrome-devtools__take_snapshot
```

The response is verbose. Search it for the role + accessible-name of the
element you want to click — e.g. `button "DEV MODE: Sign in as demo user"`.
Note the uid — it's a short string like `node_42`. Pass that to step 5.

### 5. `mcp__chrome-devtools__click` (by uid, not selector)

```
mcp__chrome-devtools__click
  uid: node_42
```

After every click that triggers async work (auth round-trip, route
navigation, tRPC call, DB query, sandbox boot), **wait 2–5 seconds** before
the next assertion. Some operations (auth → projects redirect → project
canvas mount) chain three async hops, so 5 seconds is the safer floor.

There is no built-in `wait` MCP tool — use `evaluate_script` with a
deliberate sleep:

```
mcp__chrome-devtools__evaluate_script
  function: async () => { await new Promise(r => setTimeout(r, 3000)); return 'ok'; }
```

### 6. `mcp__chrome-devtools__evaluate_script`

What: runs arbitrary JS in the page's main world and returns the result.

The function MUST be an `async () => { ... }` arrow expression. Bare
non-async expressions sometimes serialize wrong. Whatever you return must be
JSON-serializable — no DOM nodes, no functions, no Maps. Convert to plain
objects before returning.

```
mcp__chrome-devtools__evaluate_script
  function: |
    async () => {
      const iframe = document.querySelector('iframe');
      return {
        href: window.location.href,
        iframeSrc: iframe ? iframe.src : null,
        iframeDoc: iframe ? iframe.contentDocument?.body?.innerText?.slice(0, 200) : null,
      };
    }
```

This is your **primary assertion mechanism**. Every entry in a scenario's
`## Assertions` table maps to one `evaluate_script` call (or one field in a
combined call's return value).

#### Common evaluate_script patterns

Find a heading by text:

```js
async () => {
  const h2 = [...document.querySelectorAll('h2')]
    .find(el => el.textContent?.includes('Preview runtime'));
  return h2 ? h2.textContent : null;
}
```

Read a fetch response in-page:

```js
async () => {
  const r = await fetch('/preview/fcebdee5-1010-4147-9748-823a27dc36a3/main/bundle.js');
  return { status: r.status, contentType: r.headers.get('content-type') };
}
```

Wait for a DOM mutation (with timeout):

```js
async () => {
  const start = Date.now();
  while (Date.now() - start < 5000) {
    if (document.querySelector('iframe[src*="/preview/"]')) return 'found';
    await new Promise(r => setTimeout(r, 100));
  }
  return 'timeout';
}
```

### 7. `mcp__chrome-devtools__list_console_messages`

What: returns the console buffer for the active page.

When: after every navigation and after every click that triggers significant
work. Many bugs surface only as console errors (RLS denials, hydration
mismatches, missing tRPC procedures, SW registration failures).

```
mcp__chrome-devtools__list_console_messages
```

Skim the result. Anything matching the scenario's "Known issues (allowed
console noise)" list is fine; everything else is either an assertion to file
or a bug to fix before re-walking.

### 8. `mcp__chrome-devtools__take_screenshot`

What: saves a PNG of the current viewport (or full page) to disk.

```
mcp__chrome-devtools__take_screenshot
  filePath: apps/web/client/verification/onlook-editor/results/06-real-bundle.png
  fullPage: true
```

The path MUST be relative to the repo root (or absolute if your scenario
explicitly says so) and MUST live under
`apps/web/client/verification/onlook-editor/results/`. The orchestrator's
gate doesn't validate the screenshot exists — but a missing screenshot when
`state == "passed"` is treated as a false-pass and dead-letters the
scenario. **Always screenshot before updating `results.json`.**

After taking the screenshot, verify size with a quick `ls -la` or `stat`.
A 0-byte PNG indicates the page hadn't actually rendered yet — sleep 2s and
re-shoot.

## §2. Gotchas (the ones that bit Wave 0–J)

### G1. `navigate_page` default timeout is 10 seconds

The first compile of any Next.js dev route is slow. Always pass
`timeout: 120000` for verification navigations. Subsequent navigations to
the same route in the same dev-server lifetime are fast (a few hundred ms),
but you can't tell from the API call which is which — so always set the
long timeout.

### G2. `navigate_page` can lie about success

It returns `Successfully navigated` even when the server replied with a 302
or 307 to a different route. Examples seen in this project:

- Unauthenticated → `/login`
- Authenticated but no `legacy_subscriptions` row → `/see-a-demo`
- Project id not owned by the current user → `/projects`

**Always** follow `navigate_page` with an `evaluate_script` returning
`window.location.href` and assert it. If it doesn't match, the rest of the
scenario is invalid.

### G3. Async work after click needs an explicit sleep

Click → tRPC → DB → state update → re-render → mount sub-component is at
least 4 promise hops. There's no `waitForIdle` MCP tool. Sleep 2 seconds for
quick work (text input, modal open) and 5 seconds for heavy work (sandbox
boot, project canvas mount, sign-in). Then re-snapshot or re-evaluate.

### G4. `navigator.serviceWorker.ready` hangs for `/preview/` SWs

`navigator.serviceWorker.ready` only resolves when there is a registered
service worker that **controls the current page**. The SW in this project
registers with `scope: '/preview/'`, so on the parent page (the editor) it
will never control. `ready` hangs forever there.

If you need to wait for the SW to be activated, walk the registration's own
state machine:

```js
async () => {
  const reg = await navigator.serviceWorker.getRegistration('/preview/');
  if (!reg) return 'no registration';
  const sw = reg.active || reg.waiting || reg.installing;
  if (!sw) return 'no worker';
  if (sw.state === 'activated') return 'activated';
  return new Promise((resolve) => {
    sw.addEventListener('statechange', () => {
      if (sw.state === 'activated') resolve('activated');
    });
  });
}
```

This is the workaround that landed in `verification/preview-sw/` after Wave H.

### G5. BroadcastChannel from page → SW is unreliable

If a scenario depends on the page posting bundles to the SW via
`BroadcastChannel`, also wire it to listen via `self.addEventListener('message', ...)`
and post via `registration.active.postMessage(data)`. BroadcastChannel
delivery to a non-controlling SW is timing-dependent and flakes. The
pattern note in `verify-with-browser/SKILL.md` covers this.

### G6. Console noise: known false-positives

The verify-onlook isolated context blocks third-party analytics by default.
Expect — and ignore — these:

- `Failed to load resource: net::ERR_BLOCKED_BY_CLIENT` for posthog,
  segment, etc.
- React DevTools install hint
- `[HMR] connected` chatter from the dev server

Anything else in the error/warning buffer is either an assertion your
scenario is testing for or a bug. Don't silence it without an audit.

### G7. `evaluate_script` and `await` outside async

The MCP server requires the `function` parameter to be `async () => { ... }`.
A bare expression like `(() => { return 1; })()` silently strips the
return. Always wrap in `async () => { ... }` and use an explicit `return`.

### G8. Screenshots run synchronously after pending work

`take_screenshot` does **not** wait for layout or network idle. If you
screenshot 50ms after a click, you'll see the pre-click state. Always:

1. Click (or navigate)
2. `evaluate_script` with a deliberate sleep + a dom-presence probe
3. Then `take_screenshot`

### G9. The dev server's tRPC route cache

Newly-added tRPC procedures sometimes don't propagate into a long-running
`next dev` instance, even with hot reload. If `evaluate_script` calls to a
new procedure return undefined, kill `start-verify-server.sh` and restart
it before chasing a phantom procedure bug. (FOUND-04.)

## §3. After the walk

1. **Update `results.json`** following `lib/results-schema.md`. The exact
   keys are `state`, `screenshot`, `assertions[]`, `verified_at`,
   `verified_by`. Don't invent fields; the orchestrator only checks
   `state == "passed"`.
2. **Run the orchestrator gate** to confirm the JSON is well-formed and the
   state is what you think it is:
   ```bash
   jq -e '.scenarios["NN"].state == "passed"' \
     apps/web/client/verification/onlook-editor/results.json
   ```
3. **If a scenario fails:** never overwrite `verified_at` until the walk
   actually passes. Mark the entry `"failed"`, fill in the real `actual`
   values, and file an entry in
   `results.json#issues_found_during_verification` with the bug + fix note.
4. **Honest negative reports.** If the dev server won't boot, the auth flow
   blocks you, the seed didn't run, or Chrome MCP can't reach the URL — say
   so explicitly. The phrase the parent queue uses is **"NOT YET VERIFIED IN
   BROWSER"**. A 5/8-passed report is infinitely more useful than an 8/8
   "looks good" inference.

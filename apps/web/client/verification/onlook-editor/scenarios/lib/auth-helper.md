# Auth helper — DEV MODE sign-in

Step-by-step recipe for getting an authenticated Supabase session via the
Onlook editor's `DEV MODE: Sign in as demo user` button. Every Phase R/H/Q
scenario that needs to land on `/project/<id>` (i.e. all of them except the
smoke tests) must do this first.

## Why DEV MODE and not real OAuth

The verify-onlook isolated context starts with a clean cookie jar each
session, so there's no persisted user. Real OAuth flows require Google /
GitHub round-trips that Chrome MCP can't drive. The `/login` page exposes a
**"DEV MODE: Sign in as demo user"** button (only present when
`NODE_ENV !== 'production'`) that signs in as the seeded demo user with
zero round-trips.

## Pre-conditions

Before walking the auth steps:

1. **Local Supabase running.** `docker ps | grep supabase_db_onlook-web` must
   match a running container. If not:
   ```bash
   cd apps/backend && ../../node_modules/.bin/supabase start
   ```
2. **Test data seeded.** Specifically the demo user, `users` row, and
   `legacy_subscriptions` row must exist. See `lib/seed-helper.md` — running
   `bash apps/web/client/verification/onlook-editor/setup.sh` covers all
   three idempotently. Without the seed:
   - The `/login` button signs in but the next route bounces to
     `/projects` (no project rows for this user).
   - Without the `legacy_subscriptions` row, `/project/<id>` bounces to
     `/see-a-demo` instead of mounting the editor (FOUND-05).
3. **Dev server up on port 3001+.** `TR0.5` lands
   `scripts/start-verify-server.sh`; until it ships, see
   `lib/chrome-mcp-walk.md` §0 for the manual incantation.

## The credentials

| Field | Value |
|---|---|
| `USER_EMAIL` | `support@onlook.com` |
| `USER_PASSWORD` | `password` |
| `USER_ID` | `2585ea6b-6303-4f21-977c-62af2f5a21f4` |
| `display_name` | `Joan Doe` |
| `feature_flags` | `{"useExpoBrowserPreview": true}` |

These are baked into `verification/onlook-editor/setup.sh` and the Wave A
integration test fixtures. **Do not change them** in scenarios — every
helper assumes them.

The DEV MODE button doesn't actually need you to type the password; it
calls Supabase's `signInWithPassword` server-side with the hard-coded creds.
The credentials are listed here for completeness (and so a debugging agent
can call `signInWithPassword` directly if the button regresses).

## The walk — 7 Chrome MCP calls

### Step 1. List existing tabs

```
mcp__chrome-devtools__list_pages
```

If a `verify-onlook` tab is already open and the user is already signed in
(check the URL — if it's anything under `/project/...` or `/projects`,
you're signed in), `select_page` to it and skip the rest of this helper.
The session cookie persists for the life of the tab.

### Step 2. Open a fresh isolated tab (if needed)

```
mcp__chrome-devtools__new_page
  url: about:blank
  isolatedContext: verify-onlook
```

The literal context name `verify-onlook` is what every other helper assumes.
Don't change it.

### Step 3. Navigate to /login

```
mcp__chrome-devtools__navigate_page
  url: http://127.0.0.1:3001/login
  timeout: 120000
```

`timeout: 120000` is non-negotiable — first compile of `/login` in dev mode
can take 30+ seconds.

### Step 4. Confirm we landed on /login (not redirected)

```
mcp__chrome-devtools__evaluate_script
  function: async () => ({ href: window.location.href, pathname: window.location.pathname })
```

Expect:

```json
{ "href": "http://127.0.0.1:3001/login", "pathname": "/login" }
```

If `pathname` is anything else, the user is **already signed in** (the
session cookie persisted from a previous run) and `/login` redirected to
the post-auth route. Either:

- Skip the rest of this helper — you're already in.
- Or sign out first via `evaluate_script` calling
  `await fetch('/api/auth/signout', { method: 'POST' })` and re-navigate
  to `/login`.

### Step 5. Take a snapshot to find the DEV MODE button uid

```
mcp__chrome-devtools__take_snapshot
```

Search the snapshot for a button whose accessible name contains
`DEV MODE` or `Sign in as demo user`. The exact text at the time of writing
is:

> DEV MODE: Sign in as demo user

Note its uid (something like `node_42`). If you can't find the button:

- The dev server may be running with `NODE_ENV=production` — restart it
  without that flag, or use the standalone email/password flow (see
  "Fallback" below).
- The login page may be in a loading state — sleep 2 seconds and retake
  the snapshot.

### Step 6. Click the DEV MODE button

```
mcp__chrome-devtools__click
  uid: node_42
```

The click triggers:

1. `signInWithPassword` against local Supabase (~200ms)
2. Cookie set + `/login` server-action redirect to `/projects`
3. The project layout's middleware checks `legacy_subscriptions` — passes
   because the seed inserted a row
4. Server component renders `/projects` with the demo user's project list

This whole chain takes 1–3 seconds in dev mode. **Wait 3 seconds before the
next step:**

```
mcp__chrome-devtools__evaluate_script
  function: async () => { await new Promise(r => setTimeout(r, 3000)); return 'ok'; }
```

### Step 7. Confirm the post-login route

```
mcp__chrome-devtools__evaluate_script
  function: async () => ({ href: window.location.href, pathname: window.location.pathname })
```

**Expected:** `pathname === '/projects'` (or `'/project/<id>'` if the user
has exactly one project and the layout fast-paths into it — check both).

**Failure modes:**

| `pathname` | Meaning | Fix |
|---|---|---|
| `/login` | Sign-in failed; check console + dev server log | Re-run setup.sh; check Supabase auth.users has the demo user |
| `/see-a-demo` | `legacy_subscriptions` row missing | Re-run setup.sh — the seed inserts it |
| `/onboarding` | First-time user state — onboarding flag missing | Add `onboarding_completed=true` patch to setup.sh, or skip onboarding via `evaluate_script` POST |
| anything else | Unexpected redirect | Read `mcp__chrome-devtools__list_console_messages` and the dev server log |

If `pathname` is what you expected, you're authenticated and any subsequent
scenario can navigate directly to `/project/<PROJECT_ID>` without
re-running this helper. The session cookie lives for the rest of the tab's
life.

## Fallback — direct fetch to `/api/auth/signin`

If the DEV MODE button has been removed or the snapshot can't find it, sign
in by `evaluate_script`-driven fetch to the same endpoint the button uses:

```
mcp__chrome-devtools__evaluate_script
  function: |
    async () => {
      const r = await fetch('/api/auth/signin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'support@onlook.com', password: 'password' }),
      });
      return { status: r.status };
    }
```

Then re-navigate to `/projects` and confirm the cookie was set. Note: the
exact endpoint path may differ across the app's auth routing — search
`apps/web/client/src/app/login/` and `src/app/api/auth/` to confirm what's
current. Prefer the button click; this is the break-glass fallback.

## FOUND-05 — the legacy_subscriptions bypass

Background: `apps/web/client/src/app/(project)/layout.tsx` (or its current
equivalent — search the project layout) checks the user's subscription
state and redirects to `/see-a-demo` if neither a Stripe subscription nor a
`legacy_subscriptions` row exists for their email. The DEV MODE user has
neither in production schema, which means **the verification was hitting
`/see-a-demo` on every navigation to `/project/<id>` until the seed
inserted a `legacy_subscriptions` row.**

The seed (`setup.sh`) handles this with:

```sql
INSERT INTO legacy_subscriptions (email, stripe_coupon_id, stripe_promotion_code_id, stripe_promotion_code)
VALUES ('support@onlook.com', 'verify-coupon', 'verify-promo', 'VERIFY')
ON CONFLICT (email) DO NOTHING;
```

The values `verify-coupon`/`verify-promo`/`VERIFY` are filler — the layout
only checks for row existence, not the values. **Don't drop this from the
seed**, or every scenario regresses to bouncing through `/see-a-demo`.

Production fix: bypass the subscription check entirely when the DEV MODE
sign-in path is used. That's tracked in
`results.json#issues_found_during_verification` as FOUND-05 and is not in
scope for the verification suite itself.

## Quick reference

```
list_pages        → reuse if a verify-onlook tab is signed in
new_page          → isolatedContext: verify-onlook
navigate_page     → http://127.0.0.1:3001/login   timeout: 120000
evaluate_script   → confirm pathname === '/login'
take_snapshot     → find button "DEV MODE: Sign in as demo user"
click             → uid from snapshot
evaluate_script   → sleep 3000ms
evaluate_script   → confirm pathname === '/projects' (or '/project/<id>')
```

# Seed helper — idempotent test data for verification

How to seed the test user, project, branch, frame, and (after TR0.6 lands)
the real Expo fixture in Supabase Storage. Every Phase R/H/Q scenario depends
on this. The seed is **idempotent** — re-run any number of times without
breaking existing state.

## TL;DR

```bash
bash apps/web/client/verification/onlook-editor/setup.sh
```

That's it. The script is `set -euo pipefail` and prints the seeded IDs at
the end. If it exits non-zero, the verification environment is broken — fix
it before walking any scenario.

## Pre-conditions for the seed itself

| Requirement | Check | If missing |
|---|---|---|
| Docker daemon running | `docker info > /dev/null` | Start Docker Desktop |
| Local Supabase containers up | `docker ps \| grep supabase_db_onlook-web` | `cd apps/backend && ../../node_modules/.bin/supabase start` |
| Local Supabase API on `http://127.0.0.1:54321` | `curl -sf http://127.0.0.1:54321/health \| jq` | Same as above |

The script checks the Supabase container by name and exits with a clear
error message if it's missing — do NOT silently ignore it.

## What the seed produces

After a successful run:

### Auth + user

| Field | Value |
|---|---|
| `auth.users.id` | `2585ea6b-6303-4f21-977c-62af2f5a21f4` |
| `auth.users.email` | `support@onlook.com` |
| password | `password` |
| `auth.users.email_confirm` | `true` |
| `users.display_name` | `Joan Doe` |
| `users.feature_flags` | `{"useExpoBrowserPreview": true}` |

The `useExpoBrowserPreview` feature flag is what flips the editor onto the
ExpoBrowser provider for this user. Without it, the editor falls back to
the old CodeSandbox provider and every Phase R/H/Q assertion regresses.

### Subscription bypass (FOUND-05)

```sql
INSERT INTO legacy_subscriptions (email, stripe_coupon_id, stripe_promotion_code_id, stripe_promotion_code)
VALUES ('support@onlook.com', 'verify-coupon', 'verify-promo', 'VERIFY')
ON CONFLICT (email) DO NOTHING;
```

Without this row, the project layout middleware bounces every
`/project/<id>` navigation to `/see-a-demo`. See `lib/auth-helper.md` →
"FOUND-05 — the legacy_subscriptions bypass" for the full story.

### Project + canvas + branch + frame

| Table | Field | Value |
|---|---|---|
| `projects.id` | `2bff33ae-7334-457e-a69e-93a5d90b18b3` | the test PROJECT_ID |
| `projects.name` | `ExpoBrowser Verification` | |
| `projects.sandbox_id` | `verify-sandbox-id` | filler — not a real CSB sandbox |
| `user_projects` | `(user_id, project_id, role='owner')` | grants the demo user ownership |
| `canvas` | `(id, project_id)` | one canvas per project |
| `user_canvases` | `(user_id, canvas_id, scale=1, x=0, y=0)` | viewport per user |
| `branches.id` | `fcebdee5-1010-4147-9748-823a27dc36a3` | the test BRANCH_ID |
| `branches.name` | `main` | |
| `branches.provider_type` | `'expo_browser'` | flips the branch to use the ExpoBrowser provider |
| `branches.is_default` | `true` | |
| `frames` | one row per branch | `url = http://127.0.0.1:3001/preview/<BRANCH_ID>/main/`, `width=1024, height=768` |

The `frames.url` value is what the canvas iframe in the editor loads. It
points at the SW preview shell served by the ExpoBrowser provider's
`/preview/<branchId>/<frameId>/` route — see Wave H §1.1.

### Pre-existing schema patches (FOUND-01)

The seed also re-applies a known schema patch the verification keeps
finding missing on fresh local DBs:

```sql
DO $$
BEGIN
    BEGIN
        CREATE TYPE agent_type AS ENUM ('default', 'mcp');
    EXCEPTION WHEN duplicate_object THEN NULL;
    END;
END $$;
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS agent_type agent_type;
```

This is **FOUND-01** from `results.json#issues_found_during_verification`.
A real migration is the right fix; the seed patches it idempotently so
verification doesn't have to wait for the migration to land.

## Coming with TR0.6 — real Expo Storage fixture

`TR0.6` lands `scripts/seed-expo-fixture.ts` and modifies `setup.sh` to call
it as a final step. After TR0.6, `setup.sh` will additionally:

1. Read the fixture spec at `plans/expo-browser-fixture-spec.md` (TR0.2's
   deliverable) — the canonical list of files for an `expo@54` (RN 0.81,
   React 19.1, Hermes default, New Architecture on, `react-native-web@~0.21`)
   project.
2. Upload every fixture file to the Supabase Storage bucket key
   `expo-projects/${PROJECT_ID}/${BRANCH_ID}/<relative-path>` via the
   service-role admin API.
3. Refuse to overwrite files modified more recently than the fixture's
   timestamp (so a partial agent run doesn't clobber a real edit).

After TR0.6 lands:

- Scenarios 06–14 can assume `expo-projects/2bff33ae-.../fcebdee5-.../App.tsx`
  exists in Storage.
- Scenarios that need a clean slate (e.g. 07-edit-rebundle) can call
  `setup.sh` again to reset the bucket between walks.
- The TR1.x bug fixes can run their assertions against a real fixture
  rather than the imperative DOM mock the current verification uses.

Until TR0.6 lands, the bucket is empty, and Phase R Wave 3 assertions
against the real bundle will fail. The orchestrator surfaces this by
gating Wave R3+ behind TR0.6 in
`plans/expo-browser-e2e-task-queue.md`.

## How to verify the seed actually ran

After running `setup.sh`, the script prints:

```
[setup] done. Test data ready.
        Project URL: http://127.0.0.1:3001/project/2bff33ae-7334-457e-a69e-93a5d90b18b3
        Login: DEV MODE button on /login (uses support@onlook.com / password)
```

To independently confirm:

### 1. Check the auth user exists

```bash
docker exec -i supabase_db_onlook-web psql -U postgres -t -c \
  "SELECT id, email FROM auth.users WHERE id = '2585ea6b-6303-4f21-977c-62af2f5a21f4';"
```

Expect one row.

### 2. Check the project + branch are wired

```bash
docker exec -i supabase_db_onlook-web psql -U postgres -t -c \
  "SELECT p.id, b.provider_type, f.url
     FROM projects p
     JOIN branches b ON b.project_id = p.id
     JOIN frames f ON f.branch_id = b.id
    WHERE p.id = '2bff33ae-7334-457e-a69e-93a5d90b18b3';"
```

Expect one row with `provider_type = expo_browser` and a frame URL pointing
at `/preview/fcebdee5-.../main/`.

### 3. Check the legacy_subscriptions bypass

```bash
docker exec -i supabase_db_onlook-web psql -U postgres -t -c \
  "SELECT email FROM legacy_subscriptions WHERE email = 'support@onlook.com';"
```

Expect one row.

### 4. (After TR0.6) Check the Storage bucket has files

```bash
SK='eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU'
LOCAL='http://127.0.0.1:54321'
curl -s -H "Authorization: Bearer $SK" -H "apikey: $SK" \
  -X POST "$LOCAL/storage/v1/object/list/expo-projects" \
  -H 'Content-Type: application/json' \
  -d '{"prefix":"2bff33ae-7334-457e-a69e-93a5d90b18b3/fcebdee5-1010-4147-9748-823a27dc36a3/","limit":100}' \
  | jq 'length'
```

After TR0.6 this should print a number > 1 (the fixture has a `package.json`,
an `App.tsx`, an `index.tsx`, and a few support files). Before TR0.6 it
prints `0` or the bucket itself doesn't exist.

## Re-runnability + safety

The script is **safe to re-run any number of times**:

- Every `INSERT` uses `ON CONFLICT DO NOTHING` or `ON CONFLICT DO UPDATE`
- Every `ALTER TABLE` uses `IF NOT EXISTS`
- Every type creation uses `EXCEPTION WHEN duplicate_object THEN NULL`
- The auth user creation API call is wrapped in `|| echo "(already exists)"`
- The project, canvas, branch, and frame use the deterministic IDs above
  so they stack atomically

You can call it from a scenario's pre-conditions, from a wave-merge gate,
from a CI job, or from a developer's terminal. The state always converges
to the same canonical seed.

**One caveat:** if you've manually mutated the project (e.g. renamed it,
added files via the editor, run the chat agent against it) the seed does
**not** roll those mutations back. To get a perfectly clean slate, drop
the rows by hand or `supabase db reset` first, then re-run `setup.sh`.

## Common failure modes

| Symptom | Cause | Fix |
|---|---|---|
| `Supabase container ... is not running` | `supabase start` not run | `cd apps/backend && ../../node_modules/.bin/supabase start` |
| `relation "legacy_subscriptions" does not exist` | Local DB schema is older than the migrations | `bun run db:push` then re-run `setup.sh` |
| `column "agent_type" does not exist` (other tools, not setup.sh) | The patch in setup.sh didn't run yet | Run `setup.sh`; FOUND-01 is the underlying issue |
| `setup.sh` exits with `permission denied` on the curl admin API | Service role key wrong / Supabase reset rotated keys | Compare `LOCAL_SERVICE_KEY` in `setup.sh` against the key printed by `supabase start`, update if drifted |
| After running, `/project/<id>` still bounces to `/see-a-demo` | `legacy_subscriptions` row didn't insert (unique constraint hit on a stale email casing) | `DELETE FROM legacy_subscriptions WHERE email ILIKE 'support@onlook.com';` then re-run setup.sh |
| After TR0.6, Storage list returns 0 items | Service role key didn't have Storage write perms, or the bucket doesn't exist | `supabase storage create-bucket expo-projects` then re-run setup.sh |

## Quick reference

```bash
# Run the seed
bash apps/web/client/verification/onlook-editor/setup.sh

# Confirm
docker exec -i supabase_db_onlook-web psql -U postgres -t -c \
  "SELECT count(*) FROM users WHERE id = '2585ea6b-6303-4f21-977c-62af2f5a21f4';"
# → 1

# (After TR0.6) Confirm fixture
SK=...; LOCAL=http://127.0.0.1:54321
curl -s -H "Authorization: Bearer $SK" -X POST "$LOCAL/storage/v1/object/list/expo-projects" \
  -H 'Content-Type: application/json' \
  -d '{"prefix":"2bff33ae-7334-457e-a69e-93a5d90b18b3/fcebdee5-1010-4147-9748-823a27dc36a3/","limit":100}' \
  | jq 'length'
# → > 1
```

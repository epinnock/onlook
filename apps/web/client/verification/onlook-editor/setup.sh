#!/usr/bin/env bash
# verification/onlook-editor/setup.sh
#
# Idempotent setup for the Onlook editor verification suite. Creates the
# test user + project + branch + frame in the local Supabase, with the
# branch flipped to provider_type='expo_browser' and the user's
# featureFlags.useExpoBrowserPreview = true.
#
# Re-runnable: every step uses ON CONFLICT / IF NOT EXISTS / ALTER ... IF NOT
# EXISTS so it's safe to run repeatedly. The user/project/branch IDs are
# deterministic so the verification can target them by URL.
#
# Usage:
#   bash apps/web/client/verification/onlook-editor/setup.sh
#
# Prerequisites:
#   - Local Supabase running: cd apps/backend && ../../node_modules/.bin/supabase start
#   - Docker daemon running
#   - Run from anywhere — uses absolute paths
#
# Outputs (printed at the end):
#   PROJECT_ID=...
#   BRANCH_ID=...
#   FRAME_ID=...
#   USER_EMAIL=support@onlook.com
#   USER_PASSWORD=password

set -euo pipefail

LOCAL_DB_CONTAINER='supabase_db_onlook-web'
LOCAL_API_URL='http://127.0.0.1:54321'
LOCAL_SERVICE_KEY='eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU'

# Deterministic IDs — match Wave A integration test fixtures + a unique
# project that won't collide with the user's real projects.
USER_ID='2585ea6b-6303-4f21-977c-62af2f5a21f4'
USER_EMAIL='support@onlook.com'
USER_PASSWORD='password'
PROJECT_ID='2bff33ae-7334-457e-a69e-93a5d90b18b3'
BRANCH_ID='fcebdee5-1010-4147-9748-823a27dc36a3'

echo "[setup] checking local Supabase…"
if ! docker ps --format '{{.Names}}' | grep -q "^${LOCAL_DB_CONTAINER}\$"; then
    echo "[setup] ERROR: Supabase container ${LOCAL_DB_CONTAINER} is not running."
    echo "[setup] start it with: cd apps/backend && ../../node_modules/.bin/supabase start"
    exit 1
fi

echo "[setup] ensuring SEED_USER exists in auth.users via admin API…"
curl -s -X POST "${LOCAL_API_URL}/auth/v1/admin/users" \
    -H "Authorization: Bearer ${LOCAL_SERVICE_KEY}" \
    -H "apikey: ${LOCAL_SERVICE_KEY}" \
    -H 'Content-Type: application/json' \
    -d "{\"id\":\"${USER_ID}\",\"email\":\"${USER_EMAIL}\",\"password\":\"${USER_PASSWORD}\",\"email_confirm\":true,\"user_metadata\":{\"first_name\":\"Joan\",\"last_name\":\"Doe\",\"display_name\":\"Joan Doe\"}}" \
    > /dev/null || echo "[setup]   (auth user already exists — fine)"

echo "[setup] running SQL setup…"
docker exec -i "${LOCAL_DB_CONTAINER}" psql -U postgres -v ON_ERROR_STOP=1 <<SQL
-- Pre-existing schema patch (FOUND-01): conversations table needs agent_type
DO \$\$
BEGIN
    BEGIN
        CREATE TYPE agent_type AS ENUM ('default', 'mcp');
    EXCEPTION WHEN duplicate_object THEN NULL;
    END;
END \$\$;
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS agent_type agent_type;

-- public users row + feature flag
INSERT INTO users (id, email, display_name, first_name, last_name, created_at, updated_at, feature_flags)
VALUES ('${USER_ID}', '${USER_EMAIL}', 'Joan Doe', 'Joan', 'Doe', NOW(), NOW(), '{"useExpoBrowserPreview": true}'::jsonb)
ON CONFLICT (id) DO UPDATE SET feature_flags = '{"useExpoBrowserPreview": true}'::jsonb;

-- legacy subscription bypass (the project layout redirects users without
-- subscriptions to /see-a-demo)
INSERT INTO legacy_subscriptions (email, stripe_coupon_id, stripe_promotion_code_id, stripe_promotion_code)
VALUES ('${USER_EMAIL}', 'verify-coupon', 'verify-promo', 'VERIFY')
ON CONFLICT (email) DO NOTHING;

-- Test project + canvas + branch + frame
DO \$\$
DECLARE
    v_project_id  uuid := '${PROJECT_ID}';
    v_branch_id   uuid := '${BRANCH_ID}';
    v_canvas_id   uuid;
    v_frame_id    uuid;
    v_user_id     uuid := '${USER_ID}';
BEGIN
    INSERT INTO projects (id, name, description, sandbox_id, sandbox_url, created_at, updated_at)
    VALUES (v_project_id, 'ExpoBrowser Verification', 'Auto-created for verification/onlook-editor suite', 'verify-sandbox-id', '/preview/verify', NOW(), NOW())
    ON CONFLICT (id) DO NOTHING;

    INSERT INTO user_projects (user_id, project_id, role)
    VALUES (v_user_id, v_project_id, 'owner')
    ON CONFLICT (user_id, project_id) DO UPDATE SET role = 'owner';

    SELECT id INTO v_canvas_id FROM canvas WHERE project_id = v_project_id LIMIT 1;
    IF v_canvas_id IS NULL THEN
        v_canvas_id := gen_random_uuid();
        INSERT INTO canvas (id, project_id) VALUES (v_canvas_id, v_project_id);
    END IF;

    INSERT INTO user_canvases (user_id, canvas_id, scale, x, y)
    VALUES (v_user_id, v_canvas_id, 1, 0, 0)
    ON CONFLICT (user_id, canvas_id) DO NOTHING;

    INSERT INTO branches (id, project_id, name, description, sandbox_id, provider_type, is_default, created_at, updated_at)
    VALUES (v_branch_id, v_project_id, 'main', 'Verification branch', 'verify-sandbox-id', 'expo_browser', true, NOW(), NOW())
    ON CONFLICT (id) DO UPDATE SET provider_type = 'expo_browser';

    SELECT id INTO v_frame_id FROM frames WHERE branch_id = v_branch_id LIMIT 1;
    IF v_frame_id IS NULL THEN
        v_frame_id := gen_random_uuid();
        INSERT INTO frames (id, canvas_id, branch_id, x, y, width, height, url, type)
        VALUES (v_frame_id, v_canvas_id, v_branch_id, 0, 0, 1024, 768,
                'http://127.0.0.1:3001/preview/' || v_branch_id || '/main/', 'web');
    ELSE
        UPDATE frames SET url = 'http://127.0.0.1:3001/preview/' || v_branch_id || '/main/'
        WHERE id = v_frame_id;
    END IF;

    RAISE NOTICE 'project_id: %', v_project_id;
    RAISE NOTICE 'branch_id: %', v_branch_id;
    RAISE NOTICE 'frame_id: %', v_frame_id;
END \$\$;

SELECT 'PROJECT_ID=' || p.id || E'\nBRANCH_ID=' || b.id || E'\nUSER_EMAIL=${USER_EMAIL}\nUSER_PASSWORD=${USER_PASSWORD}'
FROM projects p
JOIN branches b ON b.project_id = p.id
WHERE p.id = '${PROJECT_ID}';
SQL

echo
echo "[setup] done. Test data ready."
echo "        Project URL: http://127.0.0.1:3001/project/${PROJECT_ID}"
echo "        Login: DEV MODE button on /login (uses ${USER_EMAIL} / ${USER_PASSWORD})"

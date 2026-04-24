#!/usr/bin/env bash
# reapply-rls.sh — re-run RLS-policy migrations against the local Supabase
# Postgres container after `drizzle-kit push` wipes them.
#
# drizzle-kit owns the SQL DDL for the monorepo's tables; Supabase owns the
# storage + per-table RLS policies. When drizzle pushes, it drops+recreates
# tables — which nukes every attached RLS policy. The policies are declared
# idempotently (DROP IF EXISTS + CREATE) in the SQL migration files, so the
# fix is simply to re-run those specific migrations.
#
# This is a no-op in production (production uses `supabase db push` which
# applies migrations against the remote and never runs drizzle-kit). Safe
# to run any number of times.

set -euo pipefail

MIGRATIONS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/migrations"

# Resolve the local supabase_db container name. The project_id in
# config.toml drives the suffix. Fallback to a glob search.
CONTAINER=$(docker ps --filter 'name=supabase_db_' --format '{{.Names}}' | head -n 1)
if [[ -z "${CONTAINER}" ]]; then
    echo "[reapply-rls] No supabase_db_* container running — start with \`bun run backend:start\` first." >&2
    exit 1
fi

echo "[reapply-rls] Reapplying RLS policies via ${CONTAINER}"

# Only migrations whose name clearly carries RLS policy DDL. Keep this list
# tight so we don't accidentally double-apply schema migrations that would
# conflict with drizzle's ownership.
RLS_MIGRATIONS=(
    "0006_rls.sql"
    "0007_realtime_rls.sql"
    "20260407210000_expo_projects_storage_rls.sql"
)

for file in "${RLS_MIGRATIONS[@]}"; do
    path="${MIGRATIONS_DIR}/${file}"
    if [[ ! -f "${path}" ]]; then
        echo "[reapply-rls] Skipping ${file} — not found" >&2
        continue
    fi
    echo "[reapply-rls] ${file}"
    docker exec -i "${CONTAINER}" psql -U postgres -d postgres -v ON_ERROR_STOP=1 < "${path}" > /dev/null
done

echo "[reapply-rls] Done."

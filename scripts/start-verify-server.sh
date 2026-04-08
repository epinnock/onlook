#!/usr/bin/env bash
#
# start-verify-server.sh — idempotent Next.js dev server launcher for verification
#
# Boots `next dev` (NOT turbo — see FOUND-03) from apps/web/client/ on the
# requested port, redirects logs to /tmp/onlook-verify-${TASK_ID}.log, polls
# until the server responds, then returns 0. If a server is already listening
# on the port, exits 0 without starting a second one.
#
# Env vars:
#   PORT     dev server port (default 3001)
#   TASK_ID  identifier used in the log filename (default "default")
#
# Notes:
#   - Exports NEXT_IGNORE_INCORRECT_LOCKFILE=1 to silence the Next.js 16
#     stale-lockfile patch path that hits the rogue package-lock.json in the
#     repo root (see plans/expo-browser-e2e-task-queue.md "Issue note").
#   - Never uses --turbo: turbo OOMs on long verification sessions due to
#     SWC native binding heap usage (FOUND-03).

set -euo pipefail

port="${PORT:-3001}"
task_id="${TASK_ID:-default}"
log_file="/tmp/onlook-verify-${task_id}.log"

export NEXT_IGNORE_INCORRECT_LOCKFILE=1

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd -- "${script_dir}/.." && pwd)"
client_dir="${repo_root}/apps/web/client"

# Helper: probe the dev server. Echoes the HTTP status code (or empty on failure).
probe_status() {
    curl -s -o /dev/null -w "%{http_code}" --max-time 2 "http://127.0.0.1:${port}/" 2>/dev/null || true
}

# Helper: returns 0 if the status is one of the "server is up" codes.
status_is_up() {
    local code="$1"
    case "${code}" in
        200|302|307) return 0 ;;
        *) return 1 ;;
    esac
}

# Idempotency check: if something is already serving on the port, leave it alone.
existing_status="$(probe_status)"
if status_is_up "${existing_status}"; then
    echo "[start-verify-server] dev server already responding on port ${port} (status ${existing_status}); leaving it alone"
    exit 0
fi

# Launch the dev server in the background, detached from this script's stdio.
cd "${client_dir}"
nohup bun run next dev --port "${port}" >"${log_file}" 2>&1 &
server_pid=$!
disown "${server_pid}" 2>/dev/null || true

# Poll until the server responds with a known "up" status.
attempts=60
for ((i = 1; i <= attempts; i++)); do
    if ! kill -0 "${server_pid}" 2>/dev/null; then
        echo "[start-verify-server] dev server (pid ${server_pid}) exited before responding; see ${log_file}" >&2
        exit 1
    fi
    code="$(probe_status)"
    if status_is_up "${code}"; then
        echo "[start-verify-server] dev server up on port ${port} (log: ${log_file}, pid: ${server_pid})"
        exit 0
    fi
    sleep 1
done

echo "[start-verify-server] dev server never responded on port ${port} after ${attempts} attempts; see ${log_file}" >&2
exit 1

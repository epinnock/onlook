#!/usr/bin/env bash
#
# dev-builder.sh — idempotent cf-esm-builder (Cloudflare Worker) local dev launcher
#
# Boots `wrangler dev --local` for apps/cf-esm-builder on the requested port,
# redirects logs to /tmp/cf-esm-builder-${TASK_ID}.log, polls until wrangler is
# serving requests, then returns 0. If the builder is already responding on the
# port, exits 0 without starting a second one.
#
# Env vars:
#   PORT     wrangler dev port (default 8788)
#   TASK_ID  identifier used in the log filename (default "default")
#
# Pre-flight:
#   - Docker daemon must be running (Cloudflare Containers require it for
#     Container builds in Phase H1-H3).
#   - wrangler CLI must be available on PATH.
#
# Notes:
#   - /health may not exist yet (TH2.4 hasn't landed); during polling we accept
#     ANY HTTP response as "up" — the goal is just to confirm wrangler is
#     serving requests. The idempotency check is stricter and only treats a
#     200 on /health as "already up".

set -euo pipefail

port="${PORT:-8788}"
task_id="${TASK_ID:-default}"
log_file="/tmp/cf-esm-builder-${task_id}.log"

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd -- "${script_dir}/.." && pwd)"
builder_dir="${repo_root}/apps/cf-esm-builder"

# Helper: probe /health on the builder. Echoes the HTTP status code (or empty).
probe_health() {
    curl -s -o /dev/null -w "%{http_code}" --max-time 2 "http://127.0.0.1:${port}/health" 2>/dev/null || true
}

# Helper: probe root path; used during polling where any response means "up".
probe_any() {
    curl -s -o /dev/null -w "%{http_code}" --max-time 2 "http://127.0.0.1:${port}/" 2>/dev/null || true
}

# Pre-flight 1: Docker daemon must be running (Cloudflare Containers need it).
if ! docker info >/dev/null 2>&1; then
    echo "[dev-builder] ERROR: Docker daemon not running. Phase H1-H3 require Docker for Container builds. Start Docker Desktop and retry." >&2
    exit 1
fi

# Pre-flight 2: wrangler CLI must be available.
if ! wrangler --version >/dev/null 2>&1; then
    echo "[dev-builder] ERROR: wrangler CLI not found on PATH. Install via 'bun add -g wrangler' or run through 'bunx wrangler'." >&2
    exit 1
fi

# Idempotency check: if /health already returns 200, leave the running builder alone.
existing_health="$(probe_health)"
if [[ "${existing_health}" == "200" ]]; then
    echo "[dev-builder] cf-esm-builder already responding on port ${port} (health 200); leaving it alone"
    exit 0
fi

# Launch wrangler dev in the background, detached from this script's stdio.
cd "${builder_dir}"
nohup bunx wrangler dev --port "${port}" --local >"${log_file}" 2>&1 &
pid=$!
disown "${pid}" 2>/dev/null || true

# Poll until wrangler serves any response — /health may not exist yet (pre-TH2.4).
attempts=60
for ((i = 1; i <= attempts; i++)); do
    if ! kill -0 "${pid}" 2>/dev/null; then
        echo "[dev-builder] wrangler (pid ${pid}) exited before responding; see ${log_file}" >&2
        tail -n 30 "${log_file}" >&2 || true
        exit 1
    fi
    code="$(probe_any)"
    if [[ -n "${code}" && "${code}" != "000" ]]; then
        echo "[dev-builder] cf-esm-builder up on port ${port} (log: ${log_file}, pid: ${pid})"
        exit 0
    fi
    sleep 1
done

echo "[dev-builder] cf-esm-builder never responded on port ${port} after ${attempts} attempts; see ${log_file}" >&2
tail -n 30 "${log_file}" >&2 || true
exit 1

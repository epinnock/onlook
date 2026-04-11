#!/usr/bin/env bash
#
# dev-relay.sh — idempotent cf-expo-relay (Cloudflare Worker) local dev launcher
#
# Boots `wrangler dev --local --ip 0.0.0.0` for apps/cf-expo-relay on the
# requested port, redirects logs to /tmp/cf-expo-relay-${TASK_ID}.log, polls
# until wrangler is serving requests, then prints the LAN IP (for the Expo QR
# builder) and returns 0. If the relay is already responding on the port,
# exits 0 without starting a second one.
#
# Env vars:
#   PORT     wrangler dev port (default 8787)
#   TASK_ID  identifier used in the log filename (default "default")
#
# Pre-flight:
#   - wrangler CLI must be available on PATH (no Docker required — cf-expo-relay
#     does not use Cloudflare Containers).
#
# Notes:
#   - --ip 0.0.0.0 is REQUIRED: the relay must be reachable from a phone on the
#     LAN, not just loopback. The QR code encodes the LAN IP (computed below)
#     so that the Expo client on the device can reach this dev worker.
#   - /health may not exist yet (TQ1.4 hasn't landed); during polling we accept
#     ANY HTTP response as "up" — the goal is just to confirm wrangler is
#     serving requests. The idempotency check is stricter and only treats a
#     200 on /health as "already up".

set -euo pipefail

port="${PORT:-8787}"
task_id="${TASK_ID:-default}"
log_file="/tmp/cf-expo-relay-${task_id}.log"

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd -- "${script_dir}/.." && pwd)"
relay_dir="${repo_root}/apps/cf-expo-relay"

# Helper: probe /health on the relay. Echoes the HTTP status code (or empty).
probe_health() {
    curl -s -o /dev/null -w "%{http_code}" --max-time 2 "http://127.0.0.1:${port}/health" 2>/dev/null || true
}

# Helper: probe root path; used during polling where any response means "up".
probe_any() {
    curl -s -o /dev/null -w "%{http_code}" --max-time 2 "http://127.0.0.1:${port}/" 2>/dev/null || true
}

# Helper: compute the LAN IP this host is reachable at from a phone.
# macOS: `ipconfig getifaddr en0`. Linux: `hostname -I | awk '{print $1}'`.
# Falls back to 127.0.0.1 (with a warning) if neither works.
compute_lan_ip() {
    local ip=""
    if command -v ipconfig >/dev/null 2>&1; then
        ip="$(ipconfig getifaddr en0 2>/dev/null || true)"
    fi
    if [[ -z "${ip}" ]] && command -v hostname >/dev/null 2>&1; then
        ip="$(hostname -I 2>/dev/null | awk '{print $1}' || true)"
    fi
    if [[ -z "${ip}" ]]; then
        echo "[dev-relay] WARN: could not detect LAN IP (ipconfig/hostname both failed); falling back to 127.0.0.1 — phones on the LAN will NOT be able to reach this relay" >&2
        ip="127.0.0.1"
    fi
    printf '%s' "${ip}"
}

# Pre-flight: wrangler CLI must be available.
if ! wrangler --version >/dev/null 2>&1; then
    echo "[dev-relay] ERROR: wrangler CLI not found on PATH. Install via 'bun add -g wrangler' or run through 'bunx wrangler'." >&2
    exit 1
fi

# Idempotency check: if /health already returns 200, leave the running relay alone.
existing_health="$(probe_health)"
if [[ "${existing_health}" == "200" ]]; then
    echo "[dev-relay] cf-expo-relay already responding on port ${port} (health 200); leaving it alone"
    exit 0
fi

# Launch wrangler dev in the background, detached from this script's stdio.
# --ip 0.0.0.0 is required so that phones on the LAN can reach the relay.
cd "${relay_dir}"
nohup bunx wrangler dev --port "${port}" --local --ip 0.0.0.0 >"${log_file}" 2>&1 &
pid=$!
disown "${pid}" 2>/dev/null || true

# Poll until wrangler serves any response — /health may not exist yet (pre-TQ1.4).
attempts=60
for ((i = 1; i <= attempts; i++)); do
    if ! kill -0 "${pid}" 2>/dev/null; then
        echo "[dev-relay] wrangler (pid ${pid}) exited before responding; see ${log_file}" >&2
        tail -n 30 "${log_file}" >&2 || true
        exit 1
    fi
    code="$(probe_any)"
    if [[ -n "${code}" && "${code}" != "000" ]]; then
        lan_ip="$(compute_lan_ip)"
        echo "[dev-relay] cf-expo-relay up on port ${port} (lan: ${lan_ip}, log: ${log_file}, pid: ${pid})"
        exit 0
    fi
    sleep 1
done

echo "[dev-relay] cf-expo-relay never responded on port ${port} after ${attempts} attempts; see ${log_file}" >&2
tail -n 30 "${log_file}" >&2 || true
exit 1

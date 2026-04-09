#!/usr/bin/env bash
#
# start-preview-stack.sh — bring the local Phase H/Q preview stack up from a
# clean state so a phone running Expo Go can scan the QR rendered by the
# editor and load a real Hermes bundle.
#
# What it does, in order:
#
#   1. Verify Docker daemon is running (Container build needs it).
#   2. Stop any local-builder-shim / local-relay-shim already listening on
#      the target ports so the new edits actually take effect.
#   3. Wipe /tmp/cf-builds/ — content-addressable cache entries from a
#      prior shape (no index.ios.bundle, single-platform meta.json, etc.)
#      would otherwise mask the new pipeline.
#   4. Rebuild cf-esm-builder:dev so the Container has the latest build.sh
#      / run-metro.sh / run-hermes.sh (which now produce BOTH bundles).
#      Skipped with --skip-rebuild if the user knows their image is fresh.
#   5. Re-launch local-builder-shim.ts (port 8788) and local-relay-shim.ts
#      (port 8787), bound to 0.0.0.0 so a phone on the LAN can reach them.
#   6. Health-check both shims and print the URLs the editor needs in
#      .env.local.
#
# Usage:
#   bash scripts/start-preview-stack.sh
#   LAN_IP=192.168.0.14 bash scripts/start-preview-stack.sh
#   bash scripts/start-preview-stack.sh --skip-rebuild
#
# Env vars:
#   LAN_IP          Default: auto-detected from `ipconfig getifaddr en0`
#                   (macOS) or `hostname -I` first IPv4 (Linux). The phone
#                   must be able to route to this address.
#   BUILDER_PORT    Default 8788 — local-builder-shim listen port.
#   RELAY_PORT      Default 8787 — local-relay-shim listen port.
#   IMAGE           Default cf-esm-builder:dev — Container image tag.
#   STORE_DIR       Default /tmp/cf-builds — content-addressable cache dir.
#
# Exit codes:
#   0    All shims healthy + URLs printed.
#   1    Docker daemon not running.
#   2    Container rebuild failed.
#   3    Shim failed to come up within the timeout.
#   4    Health check failed.

set -euo pipefail

# ---------------------------------------------------------------------------
# Args + env
# ---------------------------------------------------------------------------

skip_rebuild="false"
for arg in "$@"; do
    case "${arg}" in
        --skip-rebuild) skip_rebuild="true" ;;
        -h|--help)
            sed -n '2,40p' "$0"
            exit 0
            ;;
        *)
            echo "[start-preview-stack] unknown arg: ${arg}" >&2
            exit 2
            ;;
    esac
done

builder_port="${BUILDER_PORT:-8788}"
relay_port="${RELAY_PORT:-8787}"
image="${IMAGE:-cf-esm-builder:dev}"
store_dir="${STORE_DIR:-/tmp/cf-builds}"

# Auto-detect LAN IP — required so the phone can reach the shims, NOT just
# the local browser via 127.0.0.1.
if [ -z "${LAN_IP:-}" ]; then
    if command -v ipconfig >/dev/null 2>&1; then
        LAN_IP="$(ipconfig getifaddr en0 2>/dev/null || true)"
        if [ -z "${LAN_IP}" ]; then
            LAN_IP="$(ipconfig getifaddr en1 2>/dev/null || true)"
        fi
    fi
    if [ -z "${LAN_IP:-}" ] && command -v hostname >/dev/null 2>&1; then
        LAN_IP="$(hostname -I 2>/dev/null | awk '{print $1}' || true)"
    fi
fi
if [ -z "${LAN_IP:-}" ]; then
    echo "[start-preview-stack] WARN: could not auto-detect LAN_IP. Phone scans will fail. Re-run with LAN_IP=<your-ip> bash scripts/start-preview-stack.sh" >&2
    LAN_IP="127.0.0.1"
fi

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd -- "${script_dir}/.." && pwd)"

echo "[start-preview-stack] LAN_IP=${LAN_IP}"
echo "[start-preview-stack] builder=:${builder_port}  relay=:${relay_port}"
echo "[start-preview-stack] image=${image}"
echo "[start-preview-stack] store=${store_dir}"
echo "[start-preview-stack] repo=${repo_root}"

# ---------------------------------------------------------------------------
# 1. Docker pre-flight
# ---------------------------------------------------------------------------

if ! docker info >/dev/null 2>&1; then
    echo "[start-preview-stack] ERROR: Docker daemon not running. Start Docker Desktop and re-run." >&2
    exit 1
fi

# ---------------------------------------------------------------------------
# 2. Stop any existing shims on these ports
# ---------------------------------------------------------------------------

stop_port() {
    local port="$1"
    local pids
    pids="$(lsof -ti :${port} 2>/dev/null || true)"
    if [ -n "${pids}" ]; then
        echo "[start-preview-stack] killing existing process on :${port} (pids: ${pids})"
        # shellcheck disable=SC2086
        kill ${pids} 2>/dev/null || true
        sleep 1
        # If still alive, force-kill.
        pids="$(lsof -ti :${port} 2>/dev/null || true)"
        if [ -n "${pids}" ]; then
            # shellcheck disable=SC2086
            kill -9 ${pids} 2>/dev/null || true
            sleep 1
        fi
    fi
}

stop_port "${builder_port}"
stop_port "${relay_port}"

# ---------------------------------------------------------------------------
# 3. Wipe stale cache
# ---------------------------------------------------------------------------

if [ -d "${store_dir}" ]; then
    echo "[start-preview-stack] wiping ${store_dir} (stale single-platform artifacts)"
    rm -rf "${store_dir}"
fi
mkdir -p "${store_dir}"

# ---------------------------------------------------------------------------
# 4. Rebuild Container image
# ---------------------------------------------------------------------------

if [ "${skip_rebuild}" = "true" ]; then
    echo "[start-preview-stack] --skip-rebuild given; using existing ${image}"
else
    echo "[start-preview-stack] rebuilding ${image} (this can take 5–15 min on a cold cache)..."
    pushd "${repo_root}/apps/cf-esm-builder" >/dev/null
    if ! docker build -t "${image}" . >/tmp/cf-esm-builder-rebuild.log 2>&1; then
        echo "[start-preview-stack] ERROR: docker build failed. Tail of /tmp/cf-esm-builder-rebuild.log:" >&2
        tail -n 50 /tmp/cf-esm-builder-rebuild.log >&2 || true
        popd >/dev/null
        exit 2
    fi
    popd >/dev/null
    image_size="$(docker images "${image}" --format '{{.Size}}' | head -1)"
    echo "[start-preview-stack] rebuild OK (${image_size})"
fi

# ---------------------------------------------------------------------------
# 5. Re-launch shims
# ---------------------------------------------------------------------------

echo "[start-preview-stack] starting local-builder-shim on :${builder_port}..."
LAN_IP="${LAN_IP}" PORT="${builder_port}" STORE_DIR="${store_dir}" IMAGE="${image}" \
    nohup bun "${repo_root}/scripts/local-builder-shim.ts" \
        >/tmp/local-builder-shim.log 2>&1 &
builder_pid=$!
disown "${builder_pid}" 2>/dev/null || true

echo "[start-preview-stack] starting local-relay-shim on :${relay_port}..."
LAN_IP="${LAN_IP}" PORT="${relay_port}" STORE_DIR="${store_dir}" \
    CF_ESM_CACHE_URL="http://${LAN_IP}:${builder_port}" \
    nohup bun "${repo_root}/scripts/local-relay-shim.ts" \
        >/tmp/local-relay-shim.log 2>&1 &
relay_pid=$!
disown "${relay_pid}" 2>/dev/null || true

# ---------------------------------------------------------------------------
# 6. Health-check
# ---------------------------------------------------------------------------

wait_for() {
    local label="$1"
    local url="$2"
    local pid="$3"
    local attempts=30
    for ((i = 1; i <= attempts; i++)); do
        if ! kill -0 "${pid}" 2>/dev/null; then
            echo "[start-preview-stack] ERROR: ${label} (pid ${pid}) exited before becoming healthy" >&2
            return 3
        fi
        if curl -sf -o /dev/null --max-time 2 "${url}"; then
            echo "[start-preview-stack] ${label} healthy at ${url}"
            return 0
        fi
        sleep 1
    done
    echo "[start-preview-stack] ERROR: ${label} did not become healthy at ${url} after ${attempts}s" >&2
    return 4
}

wait_for "local-builder-shim" "http://127.0.0.1:${builder_port}/health" "${builder_pid}"
wait_for "local-relay-shim"   "http://127.0.0.1:${relay_port}/health"   "${relay_pid}"

# ---------------------------------------------------------------------------
# Done — print the URLs the editor needs
# ---------------------------------------------------------------------------

cat <<EOF

=========================================================================
Phase H/Q preview stack is up.

Local URLs (browser tab on this machine):
  builder      http://127.0.0.1:${builder_port}/health
  relay        http://127.0.0.1:${relay_port}/health

LAN URLs (Expo Go on your phone):
  builder      http://${LAN_IP}:${builder_port}
  relay        http://${LAN_IP}:${relay_port}

Editor .env.local should contain:
  NEXT_PUBLIC_CF_ESM_BUILDER_URL=http://${LAN_IP}:${builder_port}
  NEXT_PUBLIC_CF_EXPO_RELAY_URL=http://${LAN_IP}:${relay_port}

Logs:
  builder      tail -f /tmp/local-builder-shim.log
  relay        tail -f /tmp/local-relay-shim.log

To stop:
  bash scripts/start-preview-stack.sh   (this script kills the old ones first)
  OR
  lsof -ti :${builder_port} :${relay_port} | xargs kill
=========================================================================
EOF

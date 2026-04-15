#!/usr/bin/env bash

set -euo pipefail

usage() {
    cat <<'EOF'
Usage: bash scripts/mobile-preview/start-stack.sh <slot>

Starts the web app and mobile-preview server for the current worktree on
deterministic, slot-scoped ports.

Slot mapping:
  WEB_PORT               = 3100 + slot
  MOBILE_PREVIEW_PORT    = 8787 + slot
  MOBILE_PREVIEW_WS_PORT = 8887 + slot
EOF
}

require_slot() {
    local raw_slot="${1:-}"
    if [[ -z "${raw_slot}" ]]; then
        usage >&2
        exit 1
    fi
    if [[ ! "${raw_slot}" =~ ^[0-9]+$ ]]; then
        echo "[mobile-preview:start] slot must be a non-negative integer. Received: ${raw_slot}" >&2
        exit 1
    fi
    printf '%s' "${raw_slot}"
}

compute_lan_ip() {
    local ip=""

    if command -v ipconfig >/dev/null 2>&1; then
        ip="$(ipconfig getifaddr en0 2>/dev/null || true)"
        if [[ -z "${ip}" ]]; then
            ip="$(ipconfig getifaddr en1 2>/dev/null || true)"
        fi
    fi

    if [[ -z "${ip}" ]] && command -v hostname >/dev/null 2>&1; then
        ip="$(hostname -I 2>/dev/null | awk '{print $1}' || true)"
    fi

    if [[ -z "${ip}" ]]; then
        ip="127.0.0.1"
    fi

    printf '%s' "${ip}"
}

source_env_file() {
    local env_file="$1"
    if [[ ! -f "${env_file}" ]]; then
        return 0
    fi

    echo "[mobile-preview:start] sourcing ${env_file}"

    set -a
    # shellcheck disable=SC1090
    source "${env_file}"
    set +a
}

source_repo_env_files() {
    local root="$1"
    local client_dir="${root}/apps/web/client"

    source_env_file "${root}/.env"
    source_env_file "${root}/.env.local"
    source_env_file "${client_dir}/.env"
    source_env_file "${client_dir}/.env.local"
    source_env_file "${client_dir}/.env.development"
    source_env_file "${client_dir}/.env.development.local"
}

ensure_worktree_node_modules_copy() {
    if [[ "${PRIMARY_CHECKOUT_ROOT}" == "${WORKTREE_ROOT}" ]]; then
        return 0
    fi

    local target_node_modules="${PRIMARY_CHECKOUT_ROOT}/node_modules"
    local worktree_node_modules="${WORKTREE_ROOT}/node_modules"

    if [[ -d "${worktree_node_modules}" && ! -L "${worktree_node_modules}" ]]; then
        return 0
    fi

    if [[ ! -d "${target_node_modules}" ]]; then
        echo "[mobile-preview:start] missing shared node_modules at ${target_node_modules}" >&2
        exit 1
    fi

    rm -rf "${worktree_node_modules}"

    if cp -cR "${target_node_modules}" "${worktree_node_modules}" 2>/dev/null; then
        return 0
    fi

    cp -R "${target_node_modules}" "${worktree_node_modules}"
}

ensure_runtime_bundle() {
    if [[ -f "${RUNTIME_BUNDLE_PATH}" ]]; then
        return 0
    fi

    echo "[mobile-preview:start] building runtime bundle into ${RUNTIME_BUNDLE_PATH}"
    (
        cd "${WORKTREE_ROOT}/packages/mobile-preview"
        bun server/build-runtime.ts >"${BUILD_LOG}" 2>&1
    )
}

probe_web() {
    curl -s -o /dev/null -w "%{http_code}" --max-time 2 "http://127.0.0.1:${WEB_PORT}/" 2>/dev/null || true
}

probe_mobile_preview() {
    curl -s -o /dev/null -w "%{http_code}" --max-time 2 \
        "http://127.0.0.1:${MOBILE_PREVIEW_PORT}/health" 2>/dev/null || true
}

get_listener_pid() {
    lsof -nP -iTCP:"$1" -sTCP:LISTEN -Fp 2>/dev/null | sed -n 's/^p//p' | head -n 1
}

wait_for_listener_pid() {
    local port="$1"
    local pid_file="$2"
    local launcher_pid="$3"
    local label="$4"
    local attempts="${5:-60}"

    for ((i = 1; i <= attempts; i++)); do
        local listener_pid
        listener_pid="$(get_listener_pid "${port}")"
        if [[ -n "${listener_pid}" ]]; then
            printf '%s\n' "${listener_pid}" >"${pid_file}"
            return 0
        fi

        if [[ -n "${launcher_pid}" ]] && ! kill -0 "${launcher_pid}" 2>/dev/null; then
            echo "[mobile-preview:start] ${label} launcher exited before binding port ${port}. See ${WEB_LOG}" >&2
            return 1
        fi

        sleep 1
    done

    echo "[mobile-preview:start] ${label} did not bind port ${port}. See ${WEB_LOG}" >&2
    return 1
}

web_is_ready() {
    case "${1:-}" in
        200|302|307) return 0 ;;
        *) return 1 ;;
    esac
}

port_is_busy() {
    lsof -nP -iTCP:"$1" -sTCP:LISTEN >/dev/null 2>&1
}

wait_for_web() {
    local pid="$1"
    local attempts=120

    for ((i = 1; i <= attempts; i++)); do
        if ! kill -0 "${pid}" 2>/dev/null; then
            echo "[mobile-preview:start] web app exited before becoming ready. See ${WEB_LOG}" >&2
            return 1
        fi

        local code
        code="$(probe_web)"
        if web_is_ready "${code}"; then
            return 0
        fi

        sleep 1
    done

    echo "[mobile-preview:start] web app did not respond on ${PLAYWRIGHT_BASE_URL}. See ${WEB_LOG}" >&2
    return 1
}

wait_for_mobile_preview() {
    local pid="$1"
    local attempts=60

    for ((i = 1; i <= attempts; i++)); do
        if [[ "$(probe_mobile_preview)" == "200" ]]; then
            return 0
        fi

        sleep 1
    done

    echo "[mobile-preview:start] mobile-preview server did not respond on port ${MOBILE_PREVIEW_PORT}. See ${MOBILE_LOG}" >&2
    return 1
}

slot="$(require_slot "${1:-}")"

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd -- "${SCRIPT_DIR}/../.." && pwd)"
WORKTREE_ROOT="$(git -C "${REPO_ROOT}" rev-parse --show-toplevel)"
WORKTREE_NAME="$(basename "${WORKTREE_ROOT}")"
PRIMARY_CHECKOUT_ROOT="$(
    git -C "${WORKTREE_ROOT}" worktree list --porcelain | awk '
        /^worktree / && !seen {
            print $2
            seen = 1
        }
    '
)"

STACK_DIR="${WORKTREE_ROOT}/.tmp/mobile-preview/slot-${slot}"
STORE_DIR="${STACK_DIR}/store"
ENV_FILE="${STACK_DIR}/env.sh"
WEB_LOG="${STACK_DIR}/web.log"
MOBILE_LOG="${STACK_DIR}/mobile-preview.log"
BUILD_LOG="${STACK_DIR}/build-runtime.log"
WEB_PID_FILE="${STACK_DIR}/web.pid"
MOBILE_PID_FILE="${STACK_DIR}/mobile-preview.pid"
RUNTIME_BUNDLE_PATH="${WORKTREE_ROOT}/packages/mobile-preview/runtime/bundle.js"
mkdir -p "${STACK_DIR}" "${STORE_DIR}"

bash "${SCRIPT_DIR}/stop-stack.sh" "${slot}" >/dev/null 2>&1 || true

cleanup_on_error() {
    local status="$1"
    if [[ "${status}" -eq 0 ]]; then
        return 0
    fi

    bash "${SCRIPT_DIR}/stop-stack.sh" "${slot}" >/dev/null 2>&1 || true
}

trap 'cleanup_on_error "$?"' EXIT

source_repo_env_files "${PRIMARY_CHECKOUT_ROOT}"
if [[ "${PRIMARY_CHECKOUT_ROOT}" != "${WORKTREE_ROOT}" ]]; then
    source_repo_env_files "${WORKTREE_ROOT}"
fi
ensure_worktree_node_modules_copy

WEB_PORT=$((3100 + slot))
MOBILE_PREVIEW_PORT=$((8787 + slot))
MOBILE_PREVIEW_WS_PORT=$((8887 + slot))
PLAYWRIGHT_BASE_URL="http://127.0.0.1:${WEB_PORT}"
NEXT_PUBLIC_MOBILE_PREVIEW_URL="http://127.0.0.1:${MOBILE_PREVIEW_PORT}"
MOBILE_PREVIEW_SLOT="${slot}"
MOBILE_PREVIEW_LAN_IP="${MOBILE_PREVIEW_LAN_IP:-$(compute_lan_ip)}"

ensure_runtime_bundle

for port in "${WEB_PORT}" "${MOBILE_PREVIEW_PORT}" "${MOBILE_PREVIEW_WS_PORT}"; do
    if port_is_busy "${port}"; then
        echo "[mobile-preview:start] port ${port} is already in use. Refusing to steal another worktree's slot." >&2
        exit 1
    fi
done

cat >"${ENV_FILE}" <<EOF
export MOBILE_PREVIEW_SLOT="${MOBILE_PREVIEW_SLOT}"
export WEB_PORT="${WEB_PORT}"
export MOBILE_PREVIEW_PORT="${MOBILE_PREVIEW_PORT}"
export MOBILE_PREVIEW_WS_PORT="${MOBILE_PREVIEW_WS_PORT}"
export PLAYWRIGHT_BASE_URL="${PLAYWRIGHT_BASE_URL}"
export NEXT_PUBLIC_MOBILE_PREVIEW_URL="${NEXT_PUBLIC_MOBILE_PREVIEW_URL}"
export MOBILE_PREVIEW_LAN_IP="${MOBILE_PREVIEW_LAN_IP}"
export MOBILE_PREVIEW_STORE="${STORE_DIR}"
EOF

echo "[mobile-preview:start] worktree=${WORKTREE_NAME}"
echo "[mobile-preview:start] slot=${MOBILE_PREVIEW_SLOT} web=${WEB_PORT} mobile=${MOBILE_PREVIEW_PORT} ws=${MOBILE_PREVIEW_WS_PORT}"

(
    cd "${WORKTREE_ROOT}/apps/web/client"
    env \
        NODE_OPTIONS="${NODE_OPTIONS:---max-old-space-size=8192}" \
        PORT="${WEB_PORT}" \
        PLAYWRIGHT_PORT="${WEB_PORT}" \
        PLAYWRIGHT_BASE_URL="${PLAYWRIGHT_BASE_URL}" \
        NEXT_PUBLIC_MOBILE_PREVIEW_URL="${NEXT_PUBLIC_MOBILE_PREVIEW_URL}" \
        NEXT_TURBOPACK=0 \
        NEXT_IGNORE_INCORRECT_LOCKFILE=1 \
        NEXT_TELEMETRY_DISABLED=1 \
        SKIP_ENV_VALIDATION="${SKIP_ENV_VALIDATION:-1}" \
        nohup "${WORKTREE_ROOT}/node_modules/.bin/next" dev --hostname 127.0.0.1 --port "${WEB_PORT}" --webpack >"${WEB_LOG}" 2>&1 &
    echo $! >"${WEB_PID_FILE}"
    disown "$(cat "${WEB_PID_FILE}")" 2>/dev/null || true
)

(
    cd "${WORKTREE_ROOT}/packages/mobile-preview"
    env \
        MOBILE_PREVIEW_PORT="${MOBILE_PREVIEW_PORT}" \
        MOBILE_PREVIEW_WS_PORT="${MOBILE_PREVIEW_WS_PORT}" \
        MOBILE_PREVIEW_STORE="${STORE_DIR}" \
        MOBILE_PREVIEW_LAN_IP="${MOBILE_PREVIEW_LAN_IP}" \
        PLAYWRIGHT_BASE_URL="${PLAYWRIGHT_BASE_URL}" \
        NEXT_PUBLIC_MOBILE_PREVIEW_URL="${NEXT_PUBLIC_MOBILE_PREVIEW_URL}" \
        nohup bun run server/index.ts >"${MOBILE_LOG}" 2>&1 &
    echo $! >"${MOBILE_PID_FILE}"
    disown "$(cat "${MOBILE_PID_FILE}")" 2>/dev/null || true
)

WEB_LAUNCHER_PID="$(cat "${WEB_PID_FILE}")"
wait_for_listener_pid "${WEB_PORT}" "${WEB_PID_FILE}" "${WEB_LAUNCHER_PID}" "web app"

WEB_PID="$(cat "${WEB_PID_FILE}")"
MOBILE_PID="$(cat "${MOBILE_PID_FILE}")"

wait_for_web "${WEB_PID}"
wait_for_mobile_preview "${MOBILE_PID}"

printf '%s\n' "[mobile-preview:start] stack ready"
printf '  env file: %s\n' "${ENV_FILE}"
printf '  web:      %s\n' "${PLAYWRIGHT_BASE_URL}"
printf '  mobile:   %s\n' "${NEXT_PUBLIC_MOBILE_PREVIEW_URL}"
printf '  ws:       ws://127.0.0.1:%s\n' "${MOBILE_PREVIEW_WS_PORT}"
printf '  lan ip:   %s\n' "${MOBILE_PREVIEW_LAN_IP}"
printf '%s\n' "  logs:"
printf '    web    %s\n' "${WEB_LOG}"
printf '    mobile %s\n' "${MOBILE_LOG}"
printf '    build  %s\n' "${BUILD_LOG}"

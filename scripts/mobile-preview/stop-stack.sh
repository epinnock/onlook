#!/usr/bin/env bash

set -euo pipefail

usage() {
    cat <<'EOF'
Usage: bash scripts/mobile-preview/stop-stack.sh <slot>

Stops only the web app and mobile-preview server started by the launcher for
the current worktree and slot.
EOF
}

require_slot() {
    local raw_slot="${1:-}"
    if [[ -z "${raw_slot}" ]]; then
        usage >&2
        exit 1
    fi
    if [[ ! "${raw_slot}" =~ ^[0-9]+$ ]]; then
        echo "[mobile-preview:stop] slot must be a non-negative integer. Received: ${raw_slot}" >&2
        exit 1
    fi
    printf '%s' "${raw_slot}"
}

get_process_cwd() {
    lsof -a -d cwd -p "$1" -Fn 2>/dev/null | sed -n 's/^n//p' | head -n 1
}

pid_matches_worktree_and_port() {
    local pid="$1"
    local port="$2"

    if [[ -z "${pid}" ]]; then
        return 1
    fi
    if ! kill -0 "${pid}" 2>/dev/null; then
        return 1
    fi

    local cwd
    cwd="$(get_process_cwd "${pid}")"
    if [[ -z "${cwd}" || "${cwd}" != "${WORKTREE_ROOT}"* ]]; then
        return 1
    fi

    lsof -nP -a -iTCP:"${port}" -sTCP:LISTEN -p "${pid}" >/dev/null 2>&1
}

stop_pid_file() {
    local label="$1"
    local pid_file="$2"
    local port="$3"

    if [[ ! -f "${pid_file}" ]]; then
        return 0
    fi

    local pid
    pid="$(cat "${pid_file}")"

    if ! pid_matches_worktree_and_port "${pid}" "${port}"; then
        rm -f "${pid_file}"
        return 0
    fi

    echo "[mobile-preview:stop] stopping ${label} (pid ${pid}, port ${port})"
    kill "${pid}" 2>/dev/null || true

    for _ in {1..20}; do
        if ! kill -0 "${pid}" 2>/dev/null; then
            rm -f "${pid_file}"
            return 0
        fi
        sleep 1
    done

    echo "[mobile-preview:stop] forcing ${label} (pid ${pid})"
    kill -9 "${pid}" 2>/dev/null || true
    rm -f "${pid_file}"
}

slot="$(require_slot "${1:-}")"

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd -- "${SCRIPT_DIR}/../.." && pwd)"
WORKTREE_ROOT="$(git -C "${REPO_ROOT}" rev-parse --show-toplevel)"

WEB_PORT=$((3100 + slot))
MOBILE_PREVIEW_PORT=$((8787 + slot))

STACK_DIR="${WORKTREE_ROOT}/.tmp/mobile-preview/slot-${slot}"
WEB_PID_FILE="${STACK_DIR}/web.pid"
MOBILE_PID_FILE="${STACK_DIR}/mobile-preview.pid"

stop_pid_file "web app" "${WEB_PID_FILE}" "${WEB_PORT}"
stop_pid_file "mobile-preview server" "${MOBILE_PID_FILE}" "${MOBILE_PREVIEW_PORT}"

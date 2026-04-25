#!/usr/bin/env bash
# smoke-e2e.sh — full two-tier pipeline smoke test against two live wranglers.
#
# Spins up:
#   - cf-esm-cache stand-in (workerd, local-esm-cache-worker.ts) on :18789
#   - cf-expo-relay wrangler dev (bound to it via service binding)   on :18788
#
# Then exercises every channel the mobile-client uses:
#   1. GET /status on the cache stand-in
#   2. GET /manifest/:hash via the real relay (proxies to cache)
#   3. GET /:hash.ios.bundle via the real relay (proxies to cache)
#   4. POST /events/push + GET /events cursor cycle (EventsSession DO)
#
# Usage:
#   scripts/smoke-e2e.sh            # default ports
#   scripts/smoke-e2e.sh --keep     # leave wranglers running after the smoke
#
# Exit 0 on all green; non-zero on any assertion. When `--keep` is passed the
# script prints the PIDs so the caller can kill them manually later.

set -euo pipefail

RELAY_PORT=18788
CACHE_PORT=18789
RELAY_INSPECT=9330
CACHE_INSPECT=9331
KEEP=0
for arg in "$@"; do
    case "$arg" in
        --keep) KEEP=1 ;;
        *) echo "[smoke-e2e] unknown flag $arg" >&2; exit 2 ;;
    esac
done

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RELAY_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

cleanup() {
    if [[ "$KEEP" -eq 1 ]]; then return; fi
    if [[ -n "${RELAY_PID:-}" ]]; then kill "$RELAY_PID" 2>/dev/null || true; fi
    if [[ -n "${CACHE_PID:-}" ]]; then kill "$CACHE_PID" 2>/dev/null || true; fi
    sleep 1
}
trap cleanup EXIT

fail() {
    echo "[smoke-e2e] FAIL: $*" >&2
    exit 1
}
ok() {
    echo "[smoke-e2e] OK   $*"
}

assert_status() {
    local name="$1" expected="$2" actual="$3"
    if [[ "$actual" != "$expected" ]]; then
        fail "$name: expected status $expected, got $actual"
    fi
    ok "$name (status $actual)"
}
assert_contains() {
    local name="$1" needle="$2" haystack="$3"
    if [[ "$haystack" != *"$needle"* ]]; then
        fail "$name: body did not contain '$needle'"
    fi
    ok "$name (contains '$needle')"
}

echo "[smoke-e2e] starting cf-esm-cache stand-in on :$CACHE_PORT"
cd "$RELAY_DIR"
bunx wrangler dev \
    --config scripts/wrangler-local-esm-cache.jsonc \
    --port "$CACHE_PORT" \
    --inspector-port "$CACHE_INSPECT" \
    --local \
    > "/tmp/smoke-cache-$$.log" 2>&1 &
CACHE_PID=$!

echo "[smoke-e2e] starting cf-expo-relay on :$RELAY_PORT (inspect :$RELAY_INSPECT)"
bunx wrangler dev \
    --port "$RELAY_PORT" \
    --inspector-port "$RELAY_INSPECT" \
    --local \
    > "/tmp/smoke-relay-$$.log" 2>&1 &
RELAY_PID=$!

echo "[smoke-e2e] waiting 15s for both workers to bind..."
sleep 15

# 1. cache /status
body=$(curl -sS -w '\n%{http_code}' "http://localhost:${CACHE_PORT}/status")
status="${body##*$'\n'}"; body="${body%$'\n'*}"
assert_status "cache /status" 200 "$status"
assert_contains "cache /status body" "ok" "$body"

# 2. relay /manifest
HASH=$(printf '%064d' 1)
body=$(curl -sS -w '\n%{http_code}' \
    "http://localhost:${RELAY_PORT}/manifest/${HASH}?format=json&platform=ios")
status="${body##*$'\n'}"; body="${body%$'\n'*}"
assert_status "relay /manifest status" 200 "$status"
assert_contains "manifest runtimeVersion" '"runtimeVersion":"1"' "$body"
assert_contains "manifest launchAsset.url" ".ios.bundle" "$body"

# 3. relay /<hash>.ios.bundle proxies to cache
body=$(curl -sS -w '\n%{http_code}' \
    "http://localhost:${RELAY_PORT}/${HASH}.ios.bundle?platform=ios")
status="${body##*$'\n'}"; body="${body%$'\n'*}"
assert_status "relay bundle proxy" 200 "$status"
assert_contains "bundle body" "local-esm-cache-worker placeholder bundle" "$body"

# 4. events channel — push then poll
SESS="smoke-$(date +%s)"
resp=$(curl -sS -w '\n%{http_code}' -X POST \
    -H 'content-type: application/json' \
    -d "{\"type\":\"overlayAck\",\"data\":{\"sessionId\":\"$SESS\",\"mountedAt\":1700000000}}" \
    "http://localhost:${RELAY_PORT}/events/push?session=$SESS")
status="${resp##*$'\n'}"; body="${resp%$'\n'*}"
assert_status "events /push" 202 "$status"
assert_contains "events /push body" '"ok":true' "$body"

resp=$(curl -sS -w '\n%{http_code}' \
    "http://localhost:${RELAY_PORT}/events?session=$SESS&since=0")
status="${resp##*$'\n'}"; body="${resp%$'\n'*}"
assert_status "events /poll" 200 "$status"
assert_contains "events /poll type" '"type":"overlayAck"' "$body"

# 5. AbiHello WS chain — Phase 11b handshake round-trip + late-joiner replay
#    (delegated to a Bun script; needs the WebSocket client).
echo "[smoke-e2e] AbiHello WS chain"
if bun "${SCRIPT_DIR}/smoke-abi-hello.ts" "http://localhost:${RELAY_PORT}"; then
    ok "AbiHello WS chain (phone↔editor + late-joiner replay)"
else
    fail "AbiHello WS chain — see [smoke-abi-hello] log lines above for the failing assertion"
fi

# 6. Overlay push fan-out — the main v2 data path. Editor POSTs an
#    OverlayUpdateMessage to /push/<sessionId>; phone WS receives via
#    fan-out; late-joiner gets it via replay.
echo "[smoke-e2e] overlay v1 push WS fan-out"
if bun "${SCRIPT_DIR}/smoke-overlay-push.ts" "http://localhost:${RELAY_PORT}"; then
    ok "overlay v1 push fan-out (editor→relay→phone WS + replay)"
else
    fail "overlay v1 push fan-out — see [smoke-overlay-push] log lines above"
fi

# 7. Asset upload + check — the canonical PUT/HEAD /base-bundle/assets/<hash>
#    endpoints used by the editor uploaders retargeted in 53bd29ff +
#    321219b8. Smoke validates HEAD-unknown 404, PUT-first 201,
#    HEAD-known 200, PUT-overwrite 200, GET round-trip with content-type +
#    bytewise body match.
echo "[smoke-e2e] asset upload + check round-trip"
if bun "${SCRIPT_DIR}/smoke-asset-upload.ts" "http://localhost:${RELAY_PORT}"; then
    ok "asset upload + check round-trip (PUT 201/200, HEAD 404/200, GET full body)"
else
    fail "asset upload + check — see [smoke-asset-upload] log lines above"
fi

echo "[smoke-e2e] all green"
if [[ "$KEEP" -eq 1 ]]; then
    echo "[smoke-e2e] --keep: relay=$RELAY_PID cache=$CACHE_PID"
fi

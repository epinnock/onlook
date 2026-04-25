#!/usr/bin/env bash
# smoke-events.sh — end-to-end smoke test for the cf-expo-relay /events channel.
#
# Prereq: start wrangler dev in a separate terminal at the desired port:
#   cd apps/cf-expo-relay && bun run dev -- --port 18788 --local
#
# Usage:
#   scripts/smoke-events.sh            # defaults to http://localhost:18788
#   scripts/smoke-events.sh http://192.168.0.17:18788
#
# Exits 0 on green, non-zero on any unexpected status. Kept as a bash script
# (rather than a bun test) so the user can exercise the live relay from the
# same terminal that's tailing wrangler logs.

set -euo pipefail
BASE="${1:-http://localhost:18788}"
SESS="smoke-$(date +%s)"

echo "[smoke-events] base=$BASE session=$SESS"

assert_status() {
    local name="$1" expected="$2" actual="$3"
    if [[ "$actual" != "$expected" ]]; then
        echo "[smoke-events] FAIL $name: expected status $expected, got $actual" >&2
        exit 1
    fi
    echo "[smoke-events] OK   $name (status $actual)"
}

assert_contains() {
    local name="$1" needle="$2" haystack="$3"
    if [[ "$haystack" != *"$needle"* ]]; then
        echo "[smoke-events] FAIL $name: body did not contain '$needle'" >&2
        echo "  body: $haystack" >&2
        exit 1
    fi
    echo "[smoke-events] OK   $name (contains '$needle')"
}

# 1. empty poll
body=$(curl -sS -w '\n%{http_code}' "$BASE/events?session=$SESS&since=0")
status="${body##*$'\n'}"; body="${body%$'\n'*}"
assert_status "initial poll status" 200 "$status"
assert_contains "initial poll body" '"events":[]' "$body"

# 2. push an overlayAck
body=$(curl -sS -w '\n%{http_code}' -X POST \
    -H 'content-type: application/json' \
    -d "{\"type\":\"overlayAck\",\"data\":{\"sessionId\":\"$SESS\",\"mountedAt\":1700000000}}" \
    "$BASE/events/push?session=$SESS")
status="${body##*$'\n'}"; body="${body%$'\n'*}"
assert_status "push status" 202 "$status"
assert_contains "push body" '"ok":true' "$body"

# 3. poll and receive
body=$(curl -sS -w '\n%{http_code}' "$BASE/events?session=$SESS&since=0")
status="${body##*$'\n'}"; body="${body%$'\n'*}"
assert_status "second poll status" 200 "$status"
assert_contains "second poll body" '"type":"overlayAck"' "$body"

# 4. cursor advances — re-poll with returned cursor should be empty
body=$(curl -sS "$BASE/events?session=$SESS&since=1")
assert_contains "post-ack poll body (cursor=1)" '"events":[]' "$body"

# 5. invalid session = 400
status=$(curl -sS -o /dev/null -w '%{http_code}' "$BASE/events?session=<bogus>")
assert_status "invalid session rejection" 400 "$status"

echo "[smoke-events] all green"

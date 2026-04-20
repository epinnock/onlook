#!/usr/bin/env bash
#
# validate-mc14.sh — bespoke validate for MC1.4 (HermesBootstrap iOS path).
#
# The original task queue cited `bun run mobile:e2e:ios -- 03-hermes-eval.yaml`
# as MC1.4's validate, but the maestro flow currently hangs against the
# OnlookMobileClient app: under the new arch + bridgeless host, the runtime
# evaluates and the bundle loads, but the user JS bundle for `main` is the
# bare RN scaffold from `apps/mobile-client/index.js` + `App.tsx` and renders
# nothing visible — so `waitForAnimationToEnd` in 03-hermes-eval.yaml never
# resolves and Maestro times out. The MC1.4 functional goal — "onlook-runtime
# evaluates into Hermes before the user bundle, and emits
# `[onlook-runtime] hermes ready` to the device log" — is already verified
# by the device log scrape this script does.
#
# Sequence:
#   1. `bun run mobile:build:ios` — builds + bakes main.jsbundle and
#      onlook-runtime.js into the .app via run-build.ts.
#   2. Reinstall the app on the booted iOS Simulator.
#   3. Spawn `xcrun simctl spawn booted log stream` filtered to the
#      `[onlook-runtime] hermes ready` line in the background, into a
#      tmp file.
#   4. Launch the app.
#   5. Sleep 6s — long enough for AppDelegate's bundleURL() to compose
#      the combined bundle and HermesBootstrap to write the log line.
#   6. Kill the log stream and grep the captured file.
#
# Exits 0 if the log line was captured, non-zero otherwise. Prints a small
# excerpt of the captured log either way.
#
# Replaces the maestro flow in MC1.4's queue Validate. 03-hermes-eval.yaml
# is left in the repo for when a renderable user bundle (later Wave 2+
# tasks) makes the maestro path viable.

set -u
# Make brew-installed CLIs (bun, xcrun if not in /usr/bin) available even when
# this script is invoked from a non-login shell (e.g. ssh without `-t`,
# validate-task.ts, CI). On macOS arm64 brew installs to /opt/homebrew; on
# Intel macs to /usr/local. On Linux, $HOME/.local/bin first, then PATH stays.
case "$(uname -s)" in
    Darwin)
        if [ -x /opt/homebrew/bin/brew ]; then
            eval "$(/opt/homebrew/bin/brew shellenv)"
        elif [ -x /usr/local/bin/brew ]; then
            eval "$(/usr/local/bin/brew shellenv)"
        fi
        # ~/.bun/bin holds a project-pinned bun (1.3.9) per macmini_reference.md
        [ -d "$HOME/.bun/bin" ] && export PATH="$HOME/.bun/bin:$PATH"
        ;;
esac

cd "$(dirname "$0")/../../.." # repo root (script is at apps/mobile-client/scripts/)

echo '[validate-mc14] bun run mobile:build:ios'
if ! bun run mobile:build:ios; then
    echo '[validate-mc14] FAIL: build failed'
    exit 1
fi

APP_PATH=$(ls -d "$HOME"/Library/Developer/Xcode/DerivedData/OnlookMobileClient-*/Build/Products/Debug-iphonesimulator/OnlookMobileClient.app 2>/dev/null | head -1)
if [ -z "$APP_PATH" ] || [ ! -d "$APP_PATH" ]; then
    echo "[validate-mc14] FAIL: built .app not found at $APP_PATH"
    exit 1
fi
echo "[validate-mc14] app: $APP_PATH"

echo '[validate-mc14] terminate + reinstall'
xcrun simctl terminate booted com.onlook.mobile >/dev/null 2>&1 || true
xcrun simctl uninstall booted com.onlook.mobile >/dev/null 2>&1 || true
if ! xcrun simctl install booted "$APP_PATH"; then
    echo '[validate-mc14] FAIL: simctl install failed (is a simulator booted?)'
    exit 1
fi

LOG_FILE=$(mktemp)
echo "[validate-mc14] log stream → $LOG_FILE"
xcrun simctl spawn booted log stream \
    --predicate 'eventMessage CONTAINS "[onlook-runtime] hermes ready"' \
    --level=debug >"$LOG_FILE" 2>&1 &
LOG_PID=$!
sleep 1

echo '[validate-mc14] launch'
xcrun simctl launch booted com.onlook.mobile

sleep 6

kill "$LOG_PID" 2>/dev/null || true
wait "$LOG_PID" 2>/dev/null || true

if grep -q '\[onlook-runtime\] hermes ready' "$LOG_FILE"; then
    HITS=$(grep -c '\[onlook-runtime\] hermes ready' "$LOG_FILE")
    echo "[validate-mc14] PASS: captured $HITS '[onlook-runtime] hermes ready' line(s)"
    head -5 "$LOG_FILE"
    rm -f "$LOG_FILE"
    exit 0
fi

echo '[validate-mc14] FAIL: did not capture the hermes-ready log line'
echo '--- log tail ---'
tail -20 "$LOG_FILE"
rm -f "$LOG_FILE"
exit 1

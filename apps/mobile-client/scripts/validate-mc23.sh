#!/usr/bin/env bash
#
# validate-mc23.sh — bespoke validate for MC2.3 (OnlookRuntimeInstaller
# TurboModule registering `globalThis.OnlookRuntime`).
#
# The original task queue cited `bun run mobile:e2e:ios -- 04-global-present.yaml`
# as MC2.3's validate, but that Maestro flow currently hangs for the
# same reason as 03-hermes-eval.yaml (the bare RN scaffold under
# apps/mobile-client/index.js renders nothing visible, so
# `waitForAnimationToEnd` never resolves). See validate-mc14.sh for the
# precedent. The MC2.3 functional goal — "native C++ install() runs,
# OnlookRuntime lands on globalThis, and emits its confirmation log
# line" — is fully covered by the device-log scrape this script does.
#
# Sequence:
#   1. `bun run build:mobile-runtime` — rebuild onlook-runtime.js to
#      pick up the shell.js edit (the __turboModuleProxy('OnlookRuntimeInstaller').install()
#      call at the top of the file).
#   2. `bun run mobile:build:ios` — builds + bakes main.jsbundle and
#      onlook-runtime.js into the .app via run-build.ts.
#   3. Reinstall the app on the booted iOS Simulator.
#   4. Spawn `xcrun simctl spawn booted log stream` filtered to the
#      `[onlook-runtime] OnlookRuntime installed on globalThis` line in
#      the background, into a tmp file.
#   5. Launch the app.
#   6. Sleep 8s — long enough for AppDelegate's bundleURL() to compose
#      the combined bundle, Hermes to evaluate it, the shell.js top-of-
#      file IIFE to call installer.install(), and the C++ impl to emit
#      the log line.
#   7. Kill the log stream and grep the captured file.
#
# Exits 0 if the log line was captured, non-zero otherwise. Prints a small
# excerpt of the captured log either way.
#
# Replaces the maestro flow in MC2.3's queue Validate. 04-global-present.yaml
# remains in the repo for when a renderable user bundle (later Wave 2+
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

echo '[validate-mc23] bun run build:mobile-runtime'
if ! bun run build:mobile-runtime; then
    echo '[validate-mc23] FAIL: runtime rebuild failed'
    exit 1
fi

echo '[validate-mc23] bun run mobile:build:ios'
if ! bun run mobile:build:ios; then
    echo '[validate-mc23] FAIL: build failed'
    exit 1
fi

APP_PATH=$(ls -d "$HOME"/Library/Developer/Xcode/DerivedData/OnlookMobileClient-*/Build/Products/Debug-iphonesimulator/OnlookMobileClient.app 2>/dev/null | head -1)
if [ -z "$APP_PATH" ] || [ ! -d "$APP_PATH" ]; then
    echo "[validate-mc23] FAIL: built .app not found at $APP_PATH"
    exit 1
fi
echo "[validate-mc23] app: $APP_PATH"

echo '[validate-mc23] terminate + reinstall'
xcrun simctl terminate booted com.onlook.mobile >/dev/null 2>&1 || true
xcrun simctl uninstall booted com.onlook.mobile >/dev/null 2>&1 || true
if ! xcrun simctl install booted "$APP_PATH"; then
    echo '[validate-mc23] FAIL: simctl install failed (is a simulator booted?)'
    exit 1
fi

LOG_FILE=$(mktemp)
echo "[validate-mc23] log stream → $LOG_FILE"
xcrun simctl spawn booted log stream \
    --predicate 'eventMessage CONTAINS "OnlookRuntime installed on globalThis"' \
    --level=debug >"$LOG_FILE" 2>&1 &
LOG_PID=$!
sleep 1

echo '[validate-mc23] launch'
xcrun simctl launch booted com.onlook.mobile

sleep 8

kill "$LOG_PID" 2>/dev/null || true
wait "$LOG_PID" 2>/dev/null || true

if grep -q 'OnlookRuntime installed on globalThis' "$LOG_FILE"; then
    HITS=$(grep -c 'OnlookRuntime installed on globalThis' "$LOG_FILE")
    echo "[validate-mc23] PASS: captured $HITS 'OnlookRuntime installed on globalThis' line(s)"
    head -5 "$LOG_FILE"
    rm -f "$LOG_FILE"
    exit 0
fi

echo '[validate-mc23] FAIL: did not capture the install confirmation log line'
echo '--- log tail ---'
tail -40 "$LOG_FILE"
rm -f "$LOG_FILE"
exit 1

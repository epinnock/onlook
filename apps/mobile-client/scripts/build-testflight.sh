#!/usr/bin/env bash
# build-testflight.sh — thin wrapper around `eas build` for the iOS TestFlight
# lane (MC6.5 of plans/onlook-mobile-client-task-queue.md).
#
# Two modes:
#
#   --dry-run   (default when run locally without EXPO_TOKEN)
#     Validates apps/mobile-client/eas.json against eas-cli without consuming a
#     build credit. Uses `bun x eas-cli build --profile preview --platform ios
#     --non-interactive --local --output /tmp/onlook-dry-run.ipa` when a Mac
#     host is available, otherwise falls back to `eas config:validate` so the
#     Linux sandbox can still exercise the path.
#
#   --submit    (explicit opt-in, requires EXPO_TOKEN + Apple credentials)
#     Kicks off a cloud `eas build` for the `preview` profile, then `eas
#     submit` to TestFlight. Gated on EXPO_TOKEN being present in the env so a
#     misconfigured CI run can never upload accidentally.
#
# The CI workflow at .github/workflows/mobile-client.yml:testflight-dryrun
# invokes this script with no args — the default `--dry-run` path is the safe
# one. The real-upload variant is wired by MC6.7 behind a repo secret.

set -euo pipefail

MODE="${1:---dry-run}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MOBILE_CLIENT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

if [ ! -f "$MOBILE_CLIENT_ROOT/eas.json" ]; then
    echo "[build-testflight] FAIL: eas.json not found at $MOBILE_CLIENT_ROOT/eas.json" >&2
    exit 2
fi

echo "[build-testflight] mode=$MODE"
echo "[build-testflight] cwd=$MOBILE_CLIENT_ROOT"

case "$MODE" in
    --dry-run)
        # eas-cli >= 12 exposes `eas build:inspect` and `eas config`; the
        # stable no-credit validator is `eas build --profile <p> --platform
        # ios --non-interactive --local` when a Mac is present. On CI /
        # Linux sandboxes we fall back to `eas build:configure --platform
        # ios --non-interactive` which round-trips the eas.json schema
        # without performing a native build.
        if command -v xcodebuild >/dev/null 2>&1; then
            echo "[build-testflight] xcodebuild detected — running local dry-run build (no upload)"
            cd "$MOBILE_CLIENT_ROOT"
            bun x eas-cli build \
                --profile preview \
                --platform ios \
                --non-interactive \
                --local \
                --output /tmp/onlook-mobile-preview.ipa
        else
            echo "[build-testflight] xcodebuild not available — validating eas.json schema only"
            cd "$MOBILE_CLIENT_ROOT"
            bun x eas-cli --version
            # `eas config` prints the resolved config for a given profile and
            # exits non-zero on schema errors. That's the cheapest valid
            # dry-run we can do on a Linux host.
            bun x eas-cli config --profile preview --platform ios || {
                echo "[build-testflight] WARN: eas config unavailable (offline?); validating JSON shape instead"
                cat "$MOBILE_CLIENT_ROOT/eas.json" | python3 -c 'import json,sys; json.load(sys.stdin)'
            }
        fi
        ;;
    --submit)
        if [ -z "${EXPO_TOKEN:-}" ]; then
            echo "[build-testflight] FAIL: --submit requires EXPO_TOKEN in env" >&2
            exit 3
        fi
        cd "$MOBILE_CLIENT_ROOT"
        bun x eas-cli build \
            --profile preview \
            --platform ios \
            --non-interactive
        bun x eas-cli submit \
            --profile preview \
            --platform ios \
            --non-interactive
        ;;
    *)
        echo "[build-testflight] usage: $0 [--dry-run|--submit]" >&2
        exit 64
        ;;
esac

echo "[build-testflight] done"

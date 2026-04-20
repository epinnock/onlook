#!/usr/bin/env bash
# build-play-internal.sh — thin wrapper around `eas build`/`eas submit` for the
# Android Play Store internal-track lane (MC6.6 of
# plans/onlook-mobile-client-task-queue.md).
#
# Mirrors scripts/build-testflight.sh one-to-one so iOS and Android lanes have
# symmetrical entry points, CI contracts, and failure modes. Two modes:
#
#   --dry-run   (default when run locally without GOOGLE_PLAY_SERVICE_ACCOUNT_KEY)
#     Validates apps/mobile-client/eas.json for the preview/android profile
#     without consuming a build credit. On hosts with the Android SDK
#     (`ANDROID_HOME` set), invokes `eas build --local` to produce a local .apk
#     for smoke-testing. On hosts without the SDK (Linux sandbox / macOS
#     without SDK) falls back to `eas config --profile preview --platform
#     android`, then to a bare `json.load` of eas.json when eas-cli is offline.
#
#   --submit    (explicit opt-in, requires EXPO_TOKEN + service-account key)
#     Kicks off a cloud `eas build` for the `preview` profile on Android,
#     then `eas submit --track internal` to push the resulting .aab to the
#     Play Console's Internal Testing track. Gated on EXPO_TOKEN AND
#     GOOGLE_PLAY_SERVICE_ACCOUNT_KEY being present in the env so a
#     misconfigured CI run can never upload accidentally.
#
# The CI workflow at .github/workflows/mobile-client.yml:play-dryrun (MC6.8)
# invokes this script with no args — the default `--dry-run` path is the safe
# one. The real-upload variant is wired by MC6.8 behind a repo secret pair.
#
# Note: MCF8c (Android prebuild) is deferred at the time MC6.6 ships. Until
# that lands, `--submit` will fail at `eas build` because the generated
# `android/` directory does not yet exist. The `--dry-run` path still works
# because it only touches eas.json / the EAS config validator.

set -euo pipefail

MODE="${1:---dry-run}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MOBILE_CLIENT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

if [ ! -f "$MOBILE_CLIENT_ROOT/eas.json" ]; then
    echo "[build-play-internal] FAIL: eas.json not found at $MOBILE_CLIENT_ROOT/eas.json" >&2
    exit 2
fi

echo "[build-play-internal] mode=$MODE"
echo "[build-play-internal] cwd=$MOBILE_CLIENT_ROOT"

case "$MODE" in
    --dry-run)
        # `eas config` prints the resolved config for a given profile and exits
        # non-zero on schema errors. That's the cheapest valid dry-run we can
        # do on any host. On hosts with the Android SDK we could also run
        # `eas build --local`; we defer that to MCF8c which will activate the
        # Android prebuild side of the project.
        if [ -n "${ANDROID_HOME:-}" ] && [ -d "$MOBILE_CLIENT_ROOT/android" ]; then
            echo "[build-play-internal] ANDROID_HOME + android/ detected — running local dry-run build (no upload)"
            cd "$MOBILE_CLIENT_ROOT"
            bun x eas-cli build \
                --profile preview \
                --platform android \
                --non-interactive \
                --local \
                --output /tmp/onlook-mobile-preview.apk
        else
            echo "[build-play-internal] Android SDK / prebuild unavailable — validating eas.json schema only"
            cd "$MOBILE_CLIENT_ROOT"
            bun x eas-cli --version 2>/dev/null || {
                echo "[build-play-internal] eas-cli not installed; validating JSON shape instead"
                python3 -c "import json; json.load(open('$MOBILE_CLIENT_ROOT/eas.json'))"
                echo "[build-play-internal] done (json-only validation)"
                exit 0
            }
            bun x eas-cli config --profile preview --platform android || {
                echo "[build-play-internal] WARN: eas config unavailable (offline?); validating JSON shape instead"
                python3 -c "import json; json.load(open('$MOBILE_CLIENT_ROOT/eas.json'))"
            }
        fi
        ;;
    --submit)
        if [ -z "${EXPO_TOKEN:-}" ]; then
            echo "[build-play-internal] FAIL: --submit requires EXPO_TOKEN in env" >&2
            exit 3
        fi
        if [ -z "${GOOGLE_PLAY_SERVICE_ACCOUNT_KEY:-}" ]; then
            echo "[build-play-internal] FAIL: --submit requires GOOGLE_PLAY_SERVICE_ACCOUNT_KEY in env" >&2
            echo "[build-play-internal]       (see apps/mobile-client/docs/MC6.6-play-store.md section 1)" >&2
            exit 4
        fi
        cd "$MOBILE_CLIENT_ROOT"
        # Materialize the service-account JSON referenced by
        # submit.preview.android.serviceAccountKeyPath in eas.json.
        printf '%s' "$GOOGLE_PLAY_SERVICE_ACCOUNT_KEY" > "$MOBILE_CLIENT_ROOT/google-play-service-account.json"
        trap 'rm -f "$MOBILE_CLIENT_ROOT/google-play-service-account.json"' EXIT

        bun x eas-cli build \
            --profile preview \
            --platform android \
            --non-interactive
        bun x eas-cli submit \
            --profile preview \
            --platform android \
            --non-interactive \
            --track internal
        ;;
    *)
        echo "[build-play-internal] usage: $0 [--dry-run|--submit]" >&2
        exit 64
        ;;
esac

echo "[build-play-internal] done"

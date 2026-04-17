#!/usr/bin/env bash
#
# validate-mc18.sh — bespoke validate for MC1.8 (Expo module allowlist, ESLint half).
#
# Writes a probe TypeScript file that imports a banned module (`expo-av`),
# runs `bun --filter @onlook/mobile-client lint`, and asserts the lint exits
# non-zero. Cleans up the probe regardless of outcome.
#
# The Metro resolver block half of MC1.8 is deferred to a follow-up task;
# this script only covers the ESLint half.

set -u

cd "$(dirname "$0")/../../.." # repo root

PROBE="apps/mobile-client/src/__lint_probe__.ts"

cleanup() {
    rm -f "$PROBE"
}
trap cleanup EXIT

# 1. Baseline: lint must pass on the existing tree.
echo '[validate-mc18] baseline lint (expect exit 0)'
if ! bun --filter @onlook/mobile-client lint; then
    echo '[validate-mc18] FAIL: baseline lint failed on clean tree'
    exit 1
fi
echo '[validate-mc18] baseline OK'

# 2. Probe: import a banned module; lint must reject.
echo '[validate-mc18] writing probe → '"$PROBE"
cat >"$PROBE" <<'EOF'
// MC1.8 lint probe — this file intentionally imports a banned module.
// validate-mc18.sh asserts that `bun --filter @onlook/mobile-client lint`
// rejects this import. The trap in the script deletes this file.
import * as Av from 'expo-av';
export const _probe = Av;
EOF

echo '[validate-mc18] probe lint (expect non-zero exit)'
if bun --filter @onlook/mobile-client lint; then
    echo '[validate-mc18] FAIL: lint accepted banned expo-av import'
    exit 1
fi

echo '[validate-mc18] PASS: lint rejected banned expo-av import'
exit 0

#!/usr/bin/env bash
#
# TH1.3 — Container build smoke test for the minimal Expo SDK 54 fixture.
#
# Run by a human or CI when validating that the cf-esm-builder Container image
# can actually bundle a real Expo project end-to-end. Not invoked from the
# Bun test suite — `npm install` for this fixture pulls ~150MB of native deps
# and would blow up unit-test runtime.
#
# Steps:
#   1. Pre-flight: require `expo` (or `bunx expo`) to be on PATH; SKIP cleanly
#      if not.
#   2. Install fixture deps (`bun install` preferred, `npm install` fallback).
#   3. Run `bunx expo export:embed` for android, dev=false, to produce a
#      minified Metro bundle at /tmp/th1.3-test.bundle.
#   4. Assert the bundle is non-empty AND contains the unique fixture marker
#      string baked into App.tsx (proves the bundle came from THIS fixture,
#      not a stale /tmp leftover).
#   5. If `hermes` (or `hermesc`) is on PATH, compile the Metro bundle to
#      Hermes bytecode and assert the first 4 bytes are the canonical Hermes
#      magic header `c6 1f bc 03`. Skip the Hermes step (but still pass
#      overall) if no Hermes binary is available.
#
# Exit codes:
#   0  smoke test passed (or pre-flight skip — both are non-failing)
#   1  any failure (missing bundle, wrong magic header, marker missing, etc.)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
readonly SCRIPT_DIR
readonly FIXTURE_DIR="${SCRIPT_DIR}/fixtures/minimal-expo"
readonly BUNDLE_OUT="/tmp/th1.3-test.bundle"
readonly ASSETS_OUT="/tmp/th1.3-assets"
readonly HBC_OUT="/tmp/th1.3-test.hbc"
readonly FIXTURE_MARKER="TH1.3-minimal-expo-fixture-v1"
readonly HERMES_MAGIC="c61fbc03"

log() {
    printf '[smoke] %s\n' "$*"
}

fail() {
    printf '[smoke] FAIL: %s\n' "$*" >&2
    exit 1
}

# ---------------------------------------------------------------------------
# 1. Pre-flight
# ---------------------------------------------------------------------------

if ! command -v expo >/dev/null 2>&1 && ! command -v bunx >/dev/null 2>&1 && ! command -v npx >/dev/null 2>&1; then
    log "SKIP: expo CLI not available (no expo / bunx / npx on PATH)"
    exit 0
fi

if [ ! -d "${FIXTURE_DIR}" ]; then
    fail "fixture directory missing: ${FIXTURE_DIR}"
fi

cd "${FIXTURE_DIR}"

# ---------------------------------------------------------------------------
# 2. Install fixture deps
# ---------------------------------------------------------------------------

log "installing fixture dependencies (this is ~150MB, expect slow first run)"
if command -v bun >/dev/null 2>&1; then
    bun install --silent
elif command -v npm >/dev/null 2>&1; then
    npm install --silent
else
    fail "neither bun nor npm available to install fixture deps"
fi

# ---------------------------------------------------------------------------
# 3. Bundle via Metro (expo export:embed)
# ---------------------------------------------------------------------------

# Clean any leftover artifacts so a stale bundle from a previous run can't
# masquerade as a successful re-bundle.
rm -f "${BUNDLE_OUT}" "${HBC_OUT}"
rm -rf "${ASSETS_OUT}"
mkdir -p "${ASSETS_OUT}"

log "running expo export:embed (android, dev=false)"
if command -v bunx >/dev/null 2>&1; then
    bunx expo export:embed \
        --platform android \
        --dev false \
        --bundle-output "${BUNDLE_OUT}" \
        --assets-dest "${ASSETS_OUT}"
elif command -v npx >/dev/null 2>&1; then
    npx expo export:embed \
        --platform android \
        --dev false \
        --bundle-output "${BUNDLE_OUT}" \
        --assets-dest "${ASSETS_OUT}"
else
    fail "no bunx/npx available to run expo CLI"
fi

# ---------------------------------------------------------------------------
# 4. Assert bundle exists, is non-empty, contains the fixture marker
# ---------------------------------------------------------------------------

if [ ! -f "${BUNDLE_OUT}" ]; then
    fail "expected bundle missing: ${BUNDLE_OUT}"
fi

if [ ! -s "${BUNDLE_OUT}" ]; then
    fail "bundle is empty: ${BUNDLE_OUT}"
fi

bundle_size=$(wc -c <"${BUNDLE_OUT}" | tr -d '[:space:]')
log "bundle written: ${BUNDLE_OUT} (${bundle_size} bytes)"

if ! grep -q "${FIXTURE_MARKER}" "${BUNDLE_OUT}"; then
    fail "fixture marker '${FIXTURE_MARKER}' not found in bundle — wrong source?"
fi
log "fixture marker '${FIXTURE_MARKER}' found in bundle"

# ---------------------------------------------------------------------------
# 5. Hermes-compile + magic-header check (optional)
# ---------------------------------------------------------------------------

hermes_bin=""
if command -v hermes >/dev/null 2>&1; then
    hermes_bin="hermes"
elif command -v hermesc >/dev/null 2>&1; then
    hermes_bin="hermesc"
fi

if [ -z "${hermes_bin}" ]; then
    log "SKIP: hermes/hermesc not on PATH — skipping bytecode + magic-header check"
    log "OK: fixture bundles cleanly (Hermes step skipped)"
    exit 0
fi

log "compiling Metro bundle to Hermes bytecode via ${hermes_bin}"
"${hermes_bin}" -O -emit-binary -out "${HBC_OUT}" "${BUNDLE_OUT}"

if [ ! -s "${HBC_OUT}" ]; then
    fail "Hermes bytecode missing or empty: ${HBC_OUT}"
fi

magic_hex=$(od -An -tx1 -N4 "${HBC_OUT}" | tr -d ' \n')
if [ "${magic_hex}" != "${HERMES_MAGIC}" ]; then
    fail "Hermes magic header mismatch: got '${magic_hex}', want '${HERMES_MAGIC}'"
fi
log "Hermes magic header verified: ${magic_hex}"

log "OK: fixture bundles + Hermes-compiles cleanly"
exit 0

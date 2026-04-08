#!/usr/bin/env bash
# run-metro.sh — install JS deps + run `expo export:embed` to produce a
# Metro JS bundle. Output goes to $OUTPUT_DIR/index.android.bundle.js
# (the JS string form, before Hermes compilation).
#
# Inputs (env vars):
#   WORK_DIR    default /work
#   OUTPUT_DIR  default /output
#
# All log output goes to stderr.

set -euo pipefail

work_dir="${WORK_DIR:-/work}"
output_dir="${OUTPUT_DIR:-/output}"

mkdir -p "${output_dir}"

cd "${work_dir}"

echo "[run-metro] installing project deps..." >&2
npm install --silent --no-audit --no-fund --no-progress

echo "[run-metro] running expo export:embed (android, dev=false, minify=true)..." >&2
# Use the globally-installed expo CLI directly (the container doesn't ship bun)
expo export:embed \
    --platform android \
    --dev false \
    --minify true \
    --bundle-output "${output_dir}/index.android.bundle.js" \
    --assets-dest "${output_dir}/assets" \
    --sourcemap-output "${output_dir}/sourcemap.json" \
    --reset-cache \
    >&2

if [ ! -s "${output_dir}/index.android.bundle.js" ]; then
    echo "[run-metro] ERROR: Metro produced no bundle output" >&2
    exit 1
fi

bundle_size=$(stat -c%s "${output_dir}/index.android.bundle.js" 2>/dev/null || stat -f%z "${output_dir}/index.android.bundle.js")
echo "[run-metro] OK: Metro produced ${bundle_size} bytes of JS bundle" >&2

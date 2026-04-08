#!/usr/bin/env bash
# run-hermes.sh — compile a Metro JS bundle to Hermes bytecode and verify
# the output starts with the Hermes magic header (0xc6 0x1f 0xbc 0x03).
#
# Inputs (env vars):
#   OUTPUT_DIR  default /output
#
# Reads /output/index.android.bundle.js and writes /output/index.android.bundle
# (the Hermes bytecode form). All log output goes to stderr.

set -euo pipefail

output_dir="${OUTPUT_DIR:-/output}"
input_js="${output_dir}/index.android.bundle.js"
output_bundle="${output_dir}/index.android.bundle"
expected_magic="c61fbc03"

if [ ! -s "${input_js}" ]; then
    echo "[run-hermes] ERROR: input JS bundle missing or empty (${input_js})" >&2
    exit 1
fi

echo "[run-hermes] compiling ${input_js} to Hermes bytecode..." >&2
hermes \
    -O \
    -emit-binary \
    -out "${output_bundle}" \
    "${input_js}"

if [ ! -s "${output_bundle}" ]; then
    echo "[run-hermes] ERROR: Hermes produced no output bundle" >&2
    exit 1
fi

# Verify the magic header
magic_hex=$(od -An -tx1 -N4 "${output_bundle}" | tr -d ' \n')
if [ "${magic_hex}" != "${expected_magic}" ]; then
    echo "[run-hermes] ERROR: Hermes output missing magic header (got: ${magic_hex}, expected: ${expected_magic})" >&2
    exit 1
fi

bundle_size=$(stat -c%s "${output_bundle}" 2>/dev/null || stat -f%z "${output_bundle}")
echo "[run-hermes] OK: Hermes magic header verified (${magic_hex}), ${bundle_size} bytes" >&2

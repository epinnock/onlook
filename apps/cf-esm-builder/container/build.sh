#!/usr/bin/env bash
# build.sh — Cloudflare Containers entrypoint for cf-esm-builder.
#
# Receives source tar on stdin (or pre-staged at /input/source.tar), extracts
# it, runs Metro to produce a JS bundle, runs Hermes to compile to bytecode,
# emits the artifact set per plans/expo-browser-bundle-artifact.md, and prints
# a JSON summary on stdout. cf-esm-builder Worker (TH2.x) reads the JSON.
#
# Inputs (env vars):
#   INPUT_DIR   default /input
#   OUTPUT_DIR  default /output
#   WORK_DIR    default /work
#   SOURCE_TAR  default $INPUT_DIR/source.tar
#
# Output (stdout, single line JSON):
#   { "ok": true, "bundleHash": "PLACEHOLDER_HASH", "sizeBytes": N,
#     "builtAt": "<ISO>", "hermesVersion": "<v>" }
# OR on failure:
#   { "error": "<msg>" }
# All other log output goes to stderr.
#
# bundleHash is a placeholder — the cf-esm-builder Worker computes the
# deterministic source hash post-extraction and patches the artifact set
# before writing to R2. See plans/expo-browser-builder-protocol.md.

set -euo pipefail

input_dir="${INPUT_DIR:-/input}"
output_dir="${OUTPUT_DIR:-/output}"
work_dir="${WORK_DIR:-/work}"
source_tar="${SOURCE_TAR:-${input_dir}/source.tar}"
script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
lib_dir="${script_dir}/lib"

# When invoked from /usr/local/bin/build.sh inside the container, the lib
# scripts are siblings under /usr/local/bin/lib. Fall back if needed.
if [ ! -d "${lib_dir}" ] && [ -d "/usr/local/bin/lib" ]; then
    lib_dir="/usr/local/bin/lib"
fi

mkdir -p "${input_dir}" "${output_dir}" "${work_dir}"

# Trap unexpected failures so we always emit a JSON error
trap 'echo "{\"error\":\"build.sh aborted at line $LINENO\"}"; exit 1' ERR

# Step 1: extract
INPUT_DIR="${input_dir}" WORK_DIR="${work_dir}" SOURCE_TAR="${source_tar}" \
    bash "${lib_dir}/extract-source.sh"

# Step 2: Metro
WORK_DIR="${work_dir}" OUTPUT_DIR="${output_dir}" \
    bash "${lib_dir}/run-metro.sh"

# Step 3: Hermes
OUTPUT_DIR="${output_dir}" \
    bash "${lib_dir}/run-hermes.sh"

# Step 4: emit assetmap.json + manifest-fields.json + meta.json
asset_count=0
if [ -d "${output_dir}/assets" ]; then
    asset_count=$(find "${output_dir}/assets" -type f | wc -l | tr -d ' ')
fi
cat > "${output_dir}/assetmap.json" <<EOF
{"assets":[],"count":${asset_count}}
EOF

cd "${work_dir}"
expo_name=$(node -e "console.log(JSON.stringify(require('./app.json').expo?.name ?? 'Unknown'))")
expo_version=$(node -e "console.log(JSON.stringify(require('./app.json').expo?.version ?? '1.0.0'))")
expo_sdk=$(node -e "console.log(JSON.stringify(require('./app.json').expo?.sdkVersion ?? '54.0.0'))")
new_arch=$(node -e "console.log(JSON.stringify(require('./app.json').expo?.newArchEnabled ?? true))")
slug=$(node -e "console.log(JSON.stringify(require('./app.json').expo?.slug ?? 'unknown'))")

cat > "${output_dir}/manifest-fields.json" <<EOF
{
  "runtimeVersion": "1.0.0",
  "launchAsset": {
    "key": "bundle-PLACEHOLDER_HASH",
    "contentType": "application/javascript"
  },
  "assets": [],
  "metadata": {},
  "extra": {
    "expoClient": {
      "name": ${expo_name},
      "slug": ${slug},
      "version": ${expo_version},
      "sdkVersion": ${expo_sdk},
      "platforms": ["ios","android"],
      "icon": null,
      "splash": {"backgroundColor": "#ffffff"},
      "newArchEnabled": ${new_arch}
    },
    "scopeKey": "@onlook/preview",
    "eas": {"projectId": null}
  }
}
EOF

bundle_size=$(stat -c%s "${output_dir}/index.android.bundle" 2>/dev/null || stat -f%z "${output_dir}/index.android.bundle")
hermes_version=$(hermes --version 2>&1 | head -1 | tr -d '"' || echo "unknown")
built_at=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

cat > "${output_dir}/meta.json" <<EOF
{
  "sourceHash": "PLACEHOLDER_HASH",
  "bundleHash": "PLACEHOLDER_HASH",
  "builtAt": "${built_at}",
  "sizeBytes": ${bundle_size},
  "hermesVersion": "${hermes_version}",
  "expoSdkVersion": ${expo_sdk}
}
EOF

# Step 5: success JSON to stdout
echo "{\"ok\":true,\"bundleHash\":\"PLACEHOLDER_HASH\",\"sizeBytes\":${bundle_size},\"builtAt\":\"${built_at}\",\"hermesVersion\":\"${hermes_version}\"}"

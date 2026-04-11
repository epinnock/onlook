#!/usr/bin/env bash
# run-metro.sh — install JS deps (idempotent) + run `expo export:embed` to
# produce a Metro JS bundle for the requested platform. Output goes to
# $OUTPUT_DIR/index.${PLATFORM}.bundle.js (the JS string form, before Hermes
# compilation). build.sh calls this script twice — once with PLATFORM=android,
# once with PLATFORM=ios — so the artifact set covers both Expo Go targets.
#
# Inputs (env vars):
#   WORK_DIR    default /work
#   OUTPUT_DIR  default /output
#   PLATFORM    default android  (must be one of: android, ios)
#
# All log output goes to stderr.

set -euo pipefail

work_dir="${WORK_DIR:-/work}"
output_dir="${OUTPUT_DIR:-/output}"
platform="${PLATFORM:-android}"

case "${platform}" in
    android|ios) ;;
    *)
        echo "[run-metro] ERROR: PLATFORM must be 'android' or 'ios' (got '${platform}')" >&2
        exit 2
        ;;
esac

mkdir -p "${output_dir}"

cd "${work_dir}"

# npm install is idempotent: when run-metro.sh is invoked a second time for
# the other platform pass, the existing node_modules tree is reused and the
# install is a no-op (~50ms). Only the first call pays the ~30s install
# cost. Marker file lets us short-circuit any subsequent calls cheaply.
if [ ! -f "${work_dir}/.deps-installed" ]; then
    echo "[run-metro] installing project deps (first platform pass)..." >&2
    # --legacy-peer-deps survives the react-native-web@0.21 ↔ react@19.1 peer
    # conflict that the Phase R fixture (react + react-native-web) hits. With
    # strict peer checks, npm errors EPEER on react-dom 19.2.4 needing react
    # 19.2.4 vs the fixture's pinned react 19.1.0. Legacy mode lets npm install
    # the conflicting peers; Metro is tolerant of the actual runtime version.
    npm install --silent --no-audit --no-fund --no-progress --legacy-peer-deps
    touch "${work_dir}/.deps-installed"
else
    echo "[run-metro] reusing project deps from prior platform pass" >&2
fi

# Ensure babel-preset-expo is resolvable from /work. Babel resolves preset
# names relative to babel.config.js's directory, NOT relative to its own
# location. The global install at /usr/local/lib/node_modules/babel-preset-expo
# is invisible to Babel running from the project's cwd.
# Symlink the global copy into the project's node_modules if not already there.
if [ ! -d "${work_dir}/node_modules/babel-preset-expo" ]; then
    if [ -d "/usr/local/lib/node_modules/babel-preset-expo" ]; then
        echo "[run-metro] symlinking global babel-preset-expo into project node_modules..." >&2
        mkdir -p "${work_dir}/node_modules"
        ln -sf /usr/local/lib/node_modules/babel-preset-expo "${work_dir}/node_modules/babel-preset-expo"
    else
        echo "[run-metro] WARN: babel-preset-expo not found in global install — Metro may fail" >&2
    fi
fi

bundle_js="${output_dir}/index.${platform}.bundle.js"
sourcemap_json="${output_dir}/sourcemap.${platform}.json"

echo "[run-metro] running expo export:embed (${platform}, dev=false, minify=true)..." >&2
# Use the globally-installed expo CLI directly (the container doesn't ship bun).
# --reset-cache only on the first pass; subsequent passes reuse Metro's
# transform cache for files that survived dead-code elimination of the
# Platform.OS branch.
reset_flag=""
if [ ! -f "${work_dir}/.metro-cache-reset" ]; then
    reset_flag="--reset-cache"
    touch "${work_dir}/.metro-cache-reset"
fi
expo export:embed \
    --platform "${platform}" \
    --dev false \
    --minify true \
    --bundle-output "${bundle_js}" \
    --assets-dest "${output_dir}/assets" \
    --sourcemap-output "${sourcemap_json}" \
    ${reset_flag} \
    >&2

if [ ! -s "${bundle_js}" ]; then
    echo "[run-metro] ERROR: Metro produced no bundle output for ${platform}" >&2
    exit 1
fi

bundle_size=$(stat -c%s "${bundle_js}" 2>/dev/null || stat -f%z "${bundle_js}")
echo "[run-metro] OK: Metro produced ${bundle_size} bytes of ${platform} JS bundle" >&2

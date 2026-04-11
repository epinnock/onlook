#!/usr/bin/env bash
# extract-source.sh — receive a tar from stdin (or read from $SOURCE_TAR if
# pre-staged) and extract it into $WORK_DIR. Sanity-checks that the extracted
# project looks like an Expo project.
#
# Inputs (env vars):
#   INPUT_DIR   default /input
#   WORK_DIR    default /work
#   SOURCE_TAR  default $INPUT_DIR/source.tar
#
# All log output goes to stderr — stdout is reserved for the JSON return
# in the caller (build.sh).

set -euo pipefail

input_dir="${INPUT_DIR:-/input}"
work_dir="${WORK_DIR:-/work}"
source_tar="${SOURCE_TAR:-${input_dir}/source.tar}"

mkdir -p "${input_dir}" "${work_dir}"

if [ ! -f "${source_tar}" ]; then
    echo "[extract-source] reading source tar from stdin..." >&2
    cat > "${source_tar}"
fi

if [ ! -s "${source_tar}" ]; then
    echo "[extract-source] ERROR: source tar is empty (${source_tar})" >&2
    exit 1
fi

echo "[extract-source] extracting $(stat -c%s "${source_tar}" 2>/dev/null || stat -f%z "${source_tar}") bytes to ${work_dir}..." >&2
rm -rf "${work_dir:?}"/*
tar -xf "${source_tar}" -C "${work_dir}"

if [ ! -f "${work_dir}/package.json" ]; then
    echo "[extract-source] ERROR: source tar missing package.json" >&2
    exit 1
fi
if [ ! -f "${work_dir}/app.json" ]; then
    echo "[extract-source] ERROR: source tar missing app.json (not an Expo project)" >&2
    exit 1
fi

echo "[extract-source] OK: project extracted with package.json + app.json" >&2

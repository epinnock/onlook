#!/usr/bin/env bash
#
# binary-size-audit.sh — MCI.2: binary size audit for the iOS .app bundle.
#
# Measures the on-disk footprint of a built OnlookMobileClient.app and emits:
#   - A JSON summary to stdout (machine-readable; consumable by CI).
#   - A human-readable summary to stderr (operator-facing).
#
# The script is intentionally Mac-mini-independent at the *code* level:
#   - It only needs a path to a built .app directory.
#   - On macOS it defaults to searching ~/Library/Developer/Xcode/DerivedData
#     for the newest OnlookMobileClient.app (Debug-iphonesimulator).
#   - On Linux / CI containers it will still run if given an explicit --app
#     path (e.g. an artifact unpacked from a Mac builder).
#
# Usage:
#   apps/mobile-client/scripts/binary-size-audit.sh
#   apps/mobile-client/scripts/binary-size-audit.sh --app /path/to/OnlookMobileClient.app
#   apps/mobile-client/scripts/binary-size-audit.sh --app path/to/app > audit.json
#
# Exit codes:
#   0  audit succeeded — JSON written to stdout
#   2  no .app found (neither --app nor DerivedData search yielded a path)
#   3  required tool (du / find / stat) not on PATH
#
# JSON schema (stdout):
#   {
#     "schemaVersion": 1,
#     "generatedAt": "2026-04-11T12:34:56Z",
#     "appPath": "/absolute/path/OnlookMobileClient.app",
#     "appName": "OnlookMobileClient.app",
#     "total": { "bytes": 12345678, "human": "12M" },
#     "components": {
#       "mainBinary":    { "path": "OnlookMobileClient", "bytes": 1234, "human": "1.2K", "present": true },
#       "onlookRuntime": { "path": "onlook-runtime.js", "bytes": 1234, "human": "1.2K", "present": true },
#       "mainJsBundle":  { "path": "main.jsbundle",     "bytes": 1234, "human": "1.2K", "present": true },
#       "frameworks":    { "path": "Frameworks",        "bytes": 1234, "human": "1.2K", "present": true }
#     },
#     "top10Files": [
#       { "bytes": 1234, "human": "1.2K", "relPath": "Frameworks/hermes.framework/hermes" },
#       ...
#     ]
#   }

set -u

# ---- shell env bootstrap (mirrors validate-mc*.sh) ----
case "$(uname -s)" in
    Darwin)
        if [ -x /opt/homebrew/bin/brew ]; then
            eval "$(/opt/homebrew/bin/brew shellenv)"
        elif [ -x /usr/local/bin/brew ]; then
            eval "$(/usr/local/bin/brew shellenv)"
        fi
        [ -d "$HOME/.bun/bin" ] && export PATH="$HOME/.bun/bin:$PATH"
        ;;
esac

# ---- arg parsing ----
APP_PATH=""
while [ $# -gt 0 ]; do
    case "$1" in
        --app)
            APP_PATH="${2:-}"
            shift 2
            ;;
        --app=*)
            APP_PATH="${1#--app=}"
            shift
            ;;
        -h|--help)
            sed -n '2,50p' "$0" >&2
            exit 0
            ;;
        *)
            echo "[binary-size-audit] unknown arg: $1" >&2
            exit 64
            ;;
    esac
done

# ---- tool checks ----
for tool in du find stat awk sort head; do
    if ! command -v "$tool" >/dev/null 2>&1; then
        echo "[binary-size-audit] FAIL: required tool '$tool' not on PATH" >&2
        exit 3
    fi
done

# ---- app discovery ----
if [ -z "$APP_PATH" ]; then
    # Default: newest OnlookMobileClient.app under DerivedData.
    CANDIDATE=$(ls -dt "$HOME"/Library/Developer/Xcode/DerivedData/OnlookMobileClient-*/Build/Products/Debug-iphonesimulator/OnlookMobileClient.app 2>/dev/null | head -1 || true)
    if [ -n "$CANDIDATE" ] && [ -d "$CANDIDATE" ]; then
        APP_PATH="$CANDIDATE"
    fi
fi

if [ -z "$APP_PATH" ] || [ ! -d "$APP_PATH" ]; then
    echo "[binary-size-audit] FAIL: no .app found." >&2
    echo "[binary-size-audit] pass --app /path/to/OnlookMobileClient.app or build first." >&2
    exit 2
fi

# Absolute-ify APP_PATH without requiring GNU realpath.
APP_ABS=$(cd "$APP_PATH" && pwd)
APP_NAME=$(basename "$APP_ABS")

# ---- helpers ----
# du -sb is GNU; macOS `du` doesn't know -b. Use `stat` for byte-accurate
# single-file sizes, and a portable du-based tree size for directories.

# portable directory byte size (walks tree, sums file bytes)
dir_bytes() {
    # $1 = directory path
    # prints integer bytes; 0 on missing.
    local dir="$1"
    if [ ! -d "$dir" ]; then
        echo 0
        return 0
    fi
    # Use `find -type f -print0` + `stat` for byte-accurate sum that matches
    # across macOS (BSD stat) and Linux (GNU stat). We detect which stat we
    # have once and pick the right format flag.
    local total=0
    local line
    if stat -f %z /dev/null >/dev/null 2>&1; then
        # BSD stat (macOS)
        while IFS= read -r -d '' f; do
            line=$(stat -f %z "$f" 2>/dev/null || echo 0)
            total=$((total + line))
        done < <(find "$dir" -type f -print0)
    else
        # GNU stat (Linux / CI)
        while IFS= read -r -d '' f; do
            line=$(stat -c %s "$f" 2>/dev/null || echo 0)
            total=$((total + line))
        done < <(find "$dir" -type f -print0)
    fi
    echo "$total"
}

# portable single-path size (file or directory, bytes)
path_bytes() {
    local p="$1"
    if [ ! -e "$p" ]; then
        echo 0
        return 0
    fi
    if [ -d "$p" ]; then
        dir_bytes "$p"
        return 0
    fi
    if stat -f %z /dev/null >/dev/null 2>&1; then
        stat -f %z "$p" 2>/dev/null || echo 0
    else
        stat -c %s "$p" 2>/dev/null || echo 0
    fi
}

# Produce a human-readable size (mirrors `du -h` K/M/G output).
human_bytes() {
    local b="${1:-0}"
    awk -v b="$b" 'BEGIN {
        split("B K M G T", u, " ");
        i = 1;
        while (b >= 1024 && i < 5) { b = b / 1024; i++ }
        if (i == 1) { printf "%dB", b }
        else { printf "%.1f%s", b, u[i] }
    }'
}

# JSON string escaper (handles backslash + double quote + control chars).
json_escape() {
    awk 'BEGIN {
        for (i = 0; i < 32; i++) ctrl[sprintf("%c", i)] = sprintf("\\u%04x", i);
    }
    {
        s = $0;
        gsub(/\\/, "\\\\", s);
        gsub(/"/, "\\\"", s);
        for (c in ctrl) gsub(c, ctrl[c], s);
        printf "%s", s;
    }' <<< "$1"
}

# ---- measurement ----
TOTAL_BYTES=$(dir_bytes "$APP_ABS")
TOTAL_HUMAN=$(human_bytes "$TOTAL_BYTES")

# Key components. Paths are relative to the .app root.
MAIN_BINARY_REL="OnlookMobileClient"
RUNTIME_REL="onlook-runtime.js"
JSBUNDLE_REL="main.jsbundle"
FRAMEWORKS_REL="Frameworks"

measure_component() {
    # Args: $1 = relative path
    # Emits three space-separated fields: bytes human present(0|1)
    local rel="$1"
    local abs="$APP_ABS/$rel"
    if [ -e "$abs" ]; then
        local b
        b=$(path_bytes "$abs")
        printf '%s %s %s\n' "$b" "$(human_bytes "$b")" "1"
    else
        printf '%s %s %s\n' "0" "0B" "0"
    fi
}

read -r MB_BYTES MB_HUMAN MB_PRESENT <<<"$(measure_component "$MAIN_BINARY_REL")"
read -r RT_BYTES RT_HUMAN RT_PRESENT <<<"$(measure_component "$RUNTIME_REL")"
read -r JB_BYTES JB_HUMAN JB_PRESENT <<<"$(measure_component "$JSBUNDLE_REL")"
read -r FW_BYTES FW_HUMAN FW_PRESENT <<<"$(measure_component "$FRAMEWORKS_REL")"

# ---- top 10 files by size ----
# Emit "bytes\trelpath" for every regular file, sort desc, take first 10.
TOP10_TSV=$(
    if stat -f %z /dev/null >/dev/null 2>&1; then
        # BSD stat: -f "%z %N"  prints "bytes path" with a space.
        find "$APP_ABS" -type f -exec stat -f '%z %N' {} + 2>/dev/null \
          | awk -v prefix="$APP_ABS/" '{
                b = $1;
                # reconstruct path (may contain spaces)
                $1 = "";
                sub(/^ /, "", $0);
                rel = $0;
                sub("^" prefix, "", rel);
                printf "%d\t%s\n", b, rel;
            }' \
          | sort -rn -k1,1 \
          | head -10
    else
        # GNU stat
        find "$APP_ABS" -type f -printf '%s\t%P\n' 2>/dev/null \
          | sort -rn -k1,1 \
          | head -10
    fi
)

# ---- human-readable summary (stderr) ----
GENERATED_AT=$(date -u +%Y-%m-%dT%H:%M:%SZ)
{
    echo "[binary-size-audit] .app      : $APP_ABS"
    echo "[binary-size-audit] generated : $GENERATED_AT"
    echo "[binary-size-audit] total     : $TOTAL_HUMAN ($TOTAL_BYTES bytes)"
    echo "[binary-size-audit] components:"
    printf '  %-24s %10s  %s\n' "main binary"        "$MB_HUMAN" "$MAIN_BINARY_REL"
    printf '  %-24s %10s  %s\n' "onlook-runtime.js"  "$RT_HUMAN" "$RUNTIME_REL"
    printf '  %-24s %10s  %s\n' "main.jsbundle"      "$JB_HUMAN" "$JSBUNDLE_REL"
    printf '  %-24s %10s  %s\n' "Frameworks/"        "$FW_HUMAN" "$FRAMEWORKS_REL"
    echo "[binary-size-audit] top 10 files by size:"
    if [ -n "$TOP10_TSV" ]; then
        echo "$TOP10_TSV" | awk -F'\t' '{
            b = $1; p = $2;
            split("B K M G T", u, " ");
            i = 1; while (b >= 1024 && i < 5) { b = b / 1024; i++ }
            if (i == 1) { printf "  %10dB  %s\n", b, p }
            else        { printf "  %9.1f%s  %s\n", b, u[i], p }
        }'
    else
        echo "  (no files found)"
    fi
} >&2

# ---- JSON to stdout ----
printf '{'
printf '"schemaVersion":1,'
printf '"generatedAt":"%s",' "$GENERATED_AT"
printf '"appPath":"%s",' "$(json_escape "$APP_ABS")"
printf '"appName":"%s",' "$(json_escape "$APP_NAME")"
printf '"total":{"bytes":%d,"human":"%s"},' "$TOTAL_BYTES" "$TOTAL_HUMAN"
printf '"components":{'
printf '"mainBinary":{"path":"%s","bytes":%d,"human":"%s","present":%s},' \
    "$(json_escape "$MAIN_BINARY_REL")" "$MB_BYTES" "$MB_HUMAN" \
    "$([ "$MB_PRESENT" = "1" ] && echo true || echo false)"
printf '"onlookRuntime":{"path":"%s","bytes":%d,"human":"%s","present":%s},' \
    "$(json_escape "$RUNTIME_REL")" "$RT_BYTES" "$RT_HUMAN" \
    "$([ "$RT_PRESENT" = "1" ] && echo true || echo false)"
printf '"mainJsBundle":{"path":"%s","bytes":%d,"human":"%s","present":%s},' \
    "$(json_escape "$JSBUNDLE_REL")" "$JB_BYTES" "$JB_HUMAN" \
    "$([ "$JB_PRESENT" = "1" ] && echo true || echo false)"
printf '"frameworks":{"path":"%s","bytes":%d,"human":"%s","present":%s}' \
    "$(json_escape "$FRAMEWORKS_REL")" "$FW_BYTES" "$FW_HUMAN" \
    "$([ "$FW_PRESENT" = "1" ] && echo true || echo false)"
printf '},'
printf '"top10Files":['
if [ -n "$TOP10_TSV" ]; then
    FIRST=1
    while IFS=$'\t' read -r b rel; do
        [ -z "$b" ] && continue
        if [ "$FIRST" -eq 1 ]; then
            FIRST=0
        else
            printf ','
        fi
        printf '{"bytes":%d,"human":"%s","relPath":"%s"}' \
            "$b" "$(human_bytes "$b")" "$(json_escape "$rel")"
    done <<<"$TOP10_TSV"
fi
printf ']'
printf '}\n'

exit 0

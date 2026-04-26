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
LINT_OUT=$(mktemp)

cleanup() {
    rm -f "$PROBE" "$LINT_OUT"
}
trap cleanup EXIT

# Write the banned-import probe.
echo '[validate-mc18] writing probe → '"$PROBE"
cat >"$PROBE" <<'EOF'
// MC1.8 lint probe — this file intentionally imports a banned module.
// validate-mc18.sh asserts that `bun --filter @onlook/mobile-client lint`
// rejects this import. The trap in the script deletes this file.
import * as Av from 'expo-av';
export const _probe = Av;
EOF

# Run lint and capture output. We INTENTIONALLY do not gate on lint's exit
# code or assert a clean-tree baseline:
#   - The workspace currently carries pre-existing prettier/style warnings
#     elsewhere, so `--max-warnings 0` makes lint exit non-zero on a clean
#     tree. That's a separate cleanup concern from MC1.8's "is the
#     banned-import rule wired?" question.
#   - The sound check here is: "is the expo-av violation present in the
#     lint output for THIS probe file?" — that proves the rule fired on
#     the banned import, regardless of unrelated noise.
echo '[validate-mc18] probe lint — checking that expo-av violation is reported'
bun --filter @onlook/mobile-client lint >"$LINT_OUT" 2>&1 || true

if grep -qE "__lint_probe__" "$LINT_OUT" && grep -qE "expo-av.*no-restricted-imports" "$LINT_OUT"; then
    echo '[validate-mc18] PASS: lint flagged expo-av on probe file'
    exit 0
fi

echo '[validate-mc18] FAIL: lint did not flag expo-av on the probe file'
echo '[validate-mc18] --- lint output (probe-related lines) ---'
grep -E "__lint_probe__|expo-av|no-restricted-imports" "$LINT_OUT" || echo '(no matching lines)'
echo '[validate-mc18] --- /lint output ---'
exit 1

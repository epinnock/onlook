#!/usr/bin/env bun
/**
 * run-audit-size.ts — MCI.2 wrapper: `bun run mobile:audit:size`.
 *
 * Responsibilities:
 *   1. Optionally run `bun run mobile:build:ios` first so DerivedData has a
 *      fresh `OnlookMobileClient.app` to audit. On non-Darwin hosts (Linux
 *      dev containers, CI runners without Xcode) we skip the build step
 *      entirely — `run-build.ts` shells out to `xcodebuild`, which only
 *      exists on macOS. Developers re-auditing an existing `.app` (e.g. from
 *      an unpacked artifact) can also skip the build with `--no-build`.
 *   2. Run `bash scripts/binary-size-audit.sh` (which defaults to the newest
 *      `OnlookMobileClient-*` directory under `~/Library/Developer/Xcode/
 *      DerivedData`) and capture its JSON on stdout.
 *   3. Fail (exit non-zero) if `total.bytes` exceeds the iOS IPA calibration
 *      threshold (40 MB per MCI.2 Validate line in the task queue — see
 *      `plans/binary-size-baseline.md` section 3 for the full table). The
 *      audit script's own stdout + stderr are forwarded so CI logs keep the
 *      human-readable summary and the JSON body for artifact upload.
 *
 * Usage:
 *   bun run mobile:audit:size                 # build (if darwin) + audit + gate
 *   bun run mobile:audit:size -- --no-build   # skip build, audit existing .app
 *   bun run mobile:audit:size -- --app /path  # forwarded to audit script
 *
 * Exit codes:
 *   0  audit passed the threshold
 *   1  audit ran but total.bytes exceeded the threshold
 *   2+ audit script itself failed (missing .app, missing tool, etc.); exit
 *      code mirrors the shell script's
 */

import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

// iOS IPA calibration threshold per MCI.2 Validate line. Once the first
// Mac-mini-measured baseline lands in `plans/binary-size-baseline.md`, we'll
// tighten this to `observed × 1.10` (see that file's section 3).
const MAX_TOTAL_BYTES = 40 * 1024 * 1024;

function main(): number {
    const argv = process.argv.slice(2);
    const noBuild = argv.includes('--no-build');
    // Everything that isn't `--no-build` gets forwarded to the audit script
    // (notably `--app <path>` / `--app=<path>`).
    const forwardedArgs = argv.filter((a) => a !== '--no-build');

    const scriptDir = import.meta.dir;
    const mobileClientRoot = resolve(scriptDir, '..');
    const auditScript = resolve(scriptDir, 'binary-size-audit.sh');

    // --- 1. Build step (darwin only, skippable via --no-build) ---
    if (!noBuild && process.platform === 'darwin') {
        console.error('[mobile:audit:size] running mobile:build:ios first');
        const buildResult = spawnSync('bun', ['run', 'mobile:build:ios'], {
            cwd: mobileClientRoot,
            stdio: 'inherit',
        });
        if (buildResult.status !== 0) {
            console.error(
                `[mobile:audit:size] mobile:build:ios failed (exit ${buildResult.status ?? 'unknown'})`,
            );
            return buildResult.status ?? 1;
        }
    } else if (!noBuild) {
        console.error(
            `[mobile:audit:size] skipping mobile:build:ios — xcodebuild only available on macOS (host: ${process.platform}).`,
        );
        console.error(
            '[mobile:audit:size] pass --app <path> to audit an artifact unpacked from a Mac builder.',
        );
    } else {
        console.error('[mobile:audit:size] --no-build set, skipping build step');
    }

    // --- 2. Run the audit, capturing JSON on stdout ---
    const auditResult = spawnSync('bash', [auditScript, ...forwardedArgs], {
        cwd: mobileClientRoot,
        encoding: 'utf8',
    });

    // Forward stderr (human-readable summary) and stdout (JSON doc) as-is so
    // CI logs + artifact capture keep working without special-casing.
    if (auditResult.stderr) {
        process.stderr.write(auditResult.stderr);
    }
    if (auditResult.stdout) {
        process.stdout.write(auditResult.stdout);
    }

    const auditStatus = auditResult.status ?? 1;
    if (auditStatus !== 0) {
        console.error(
            `[mobile:audit:size] audit script exited ${auditStatus}; cannot gate on threshold.`,
        );
        return auditStatus;
    }

    // --- 3. Parse JSON + gate on total.bytes ---
    let totalBytes = 0;
    try {
        const parsed = JSON.parse(auditResult.stdout) as {
            total?: { bytes?: number };
        };
        totalBytes = parsed.total?.bytes ?? 0;
    } catch (err) {
        console.error(
            `[mobile:audit:size] failed to parse audit JSON: ${(err as Error).message}`,
        );
        return 1;
    }

    const maxMb = MAX_TOTAL_BYTES / (1024 * 1024);
    const totalMb = (totalBytes / (1024 * 1024)).toFixed(2);
    if (totalBytes > MAX_TOTAL_BYTES) {
        console.error(
            `[mobile:audit:size] FAIL: total.bytes = ${totalBytes} (${totalMb} MB) exceeds threshold ${MAX_TOTAL_BYTES} (${maxMb} MB).`,
        );
        return 1;
    }

    console.error(
        `[mobile:audit:size] OK: total.bytes = ${totalBytes} (${totalMb} MB) within threshold ${maxMb} MB.`,
    );
    return 0;
}

process.exit(main());

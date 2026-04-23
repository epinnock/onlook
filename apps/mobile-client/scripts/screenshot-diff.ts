#!/usr/bin/env bun
/**
 * screenshot-diff.ts — lightweight screenshot-pair comparison for CI.
 *
 * Purpose: give MCG.11's real-relay E2E a pass/fail signal against the two
 * baseline screenshots at `plans/adr/assets/v2-pipeline/v2r-{hello,updated}.png`.
 * Ships without an imagemagick / sharp dependency — compares:
 *   1. sha256    — exact-match gate (fastest, highest confidence when it passes)
 *   2. file size — coarse-match fallback within a configurable tolerance, for
 *                  runs where anti-aliasing / system-UI clock drift make the
 *                  hash diverge but the overall layout matches.
 *
 * Usage:
 *   bun run scripts/screenshot-diff.ts <baseline> <candidate> [--tolerance 0.05]
 *   bun run scripts/screenshot-diff.ts baseline.png candidate.png --json
 *
 * Exit codes:
 *   0 — match (hash OR size-delta within tolerance)
 *   1 — mismatch (sizes differ beyond tolerance)
 *   2 — usage / I/O error
 *
 * Non-goal: full perceptual diff. Delegate that to MCG.11's follow-up when
 * this coarse gate starts producing false positives — swap the comparer
 * module for `sharp` + pHash or similar.
 */

import { createHash } from 'node:crypto';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { basename, resolve } from 'node:path';

export type DiffTier = 'hash' | 'size' | 'mismatch';

export type DiffResult = {
    match: boolean;
    tier: DiffTier;
    baseline: { path: string; bytes: number; sha256: string };
    candidate: { path: string; bytes: number; sha256: string };
    sizeDeltaBytes: number;
    sizeDeltaRatio: number;
    tolerance: number;
    reason: string;
};

export function sha256(buf: Buffer): string {
    return createHash('sha256').update(buf).digest('hex');
}

export function compareScreenshots(
    baselinePath: string,
    candidatePath: string,
    tolerance: number,
): DiffResult {
    if (tolerance < 0 || tolerance > 1) {
        throw new Error(`tolerance must be in [0, 1]; got ${tolerance}`);
    }
    if (!existsSync(baselinePath)) {
        throw new Error(`baseline not found: ${baselinePath}`);
    }
    if (!existsSync(candidatePath)) {
        throw new Error(`candidate not found: ${candidatePath}`);
    }
    const baselineBuf = readFileSync(baselinePath);
    const candidateBuf = readFileSync(candidatePath);
    const baselineHash = sha256(baselineBuf);
    const candidateHash = sha256(candidateBuf);
    const baselineSize = baselineBuf.length;
    const candidateSize = candidateBuf.length;
    const sizeDeltaBytes = candidateSize - baselineSize;
    const sizeDeltaRatio = baselineSize === 0 ? 0 : Math.abs(sizeDeltaBytes) / baselineSize;

    const baseResult = {
        baseline: { path: baselinePath, bytes: baselineSize, sha256: baselineHash },
        candidate: { path: candidatePath, bytes: candidateSize, sha256: candidateHash },
        sizeDeltaBytes,
        sizeDeltaRatio,
        tolerance,
    };

    if (baselineHash === candidateHash) {
        return {
            ...baseResult,
            match: true,
            tier: 'hash',
            reason: `sha256 identical (${baselineHash.slice(0, 12)}…)`,
        };
    }
    if (sizeDeltaRatio <= tolerance) {
        return {
            ...baseResult,
            match: true,
            tier: 'size',
            reason: `size within tolerance (${(sizeDeltaRatio * 100).toFixed(2)}% ≤ ${(tolerance * 100).toFixed(2)}%)`,
        };
    }
    return {
        ...baseResult,
        match: false,
        tier: 'mismatch',
        reason: `size delta ${(sizeDeltaRatio * 100).toFixed(2)}% exceeds tolerance ${(tolerance * 100).toFixed(2)}%`,
    };
}

export type ParsedArgs = {
    baseline: string;
    candidate: string;
    tolerance: number;
    json: boolean;
};

export function parseArgs(argv: readonly string[]): ParsedArgs {
    const positional: string[] = [];
    let tolerance = 0.05;
    let json = false;
    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i] ?? '';
        if (arg === '--tolerance') {
            const next = argv[i + 1];
            if (next === undefined) throw new Error('--tolerance requires a value');
            tolerance = Number(next);
            if (!Number.isFinite(tolerance)) {
                throw new Error(`--tolerance must be numeric; got ${next}`);
            }
            i++;
        } else if (arg.startsWith('--tolerance=')) {
            tolerance = Number(arg.slice('--tolerance='.length));
            if (!Number.isFinite(tolerance)) {
                throw new Error(`--tolerance must be numeric; got ${arg}`);
            }
        } else if (arg === '--json') {
            json = true;
        } else if (arg.startsWith('--')) {
            throw new Error(`unknown flag: ${arg}`);
        } else {
            positional.push(arg);
        }
    }
    if (positional.length !== 2) {
        throw new Error(
            `usage: screenshot-diff.ts <baseline> <candidate> [--tolerance N] [--json]; got ${positional.length} positional args`,
        );
    }
    return {
        baseline: resolve(positional[0] ?? ''),
        candidate: resolve(positional[1] ?? ''),
        tolerance,
        json,
    };
}

function formatHuman(result: DiffResult): string {
    const bName = basename(result.baseline.path);
    const cName = basename(result.candidate.path);
    const verdict = result.match ? 'MATCH' : 'MISMATCH';
    return [
        `[screenshot-diff] ${verdict} (${result.tier})`,
        `  baseline:  ${bName} (${result.baseline.bytes} bytes, ${result.baseline.sha256.slice(0, 12)}…)`,
        `  candidate: ${cName} (${result.candidate.bytes} bytes, ${result.candidate.sha256.slice(0, 12)}…)`,
        `  delta:     ${result.sizeDeltaBytes >= 0 ? '+' : ''}${result.sizeDeltaBytes} bytes (${(result.sizeDeltaRatio * 100).toFixed(2)}%)`,
        `  reason:    ${result.reason}`,
    ].join('\n');
}

function main(): number {
    let parsed: ParsedArgs;
    try {
        parsed = parseArgs(process.argv.slice(2));
    } catch (err) {
        console.error(`[screenshot-diff] ${(err as Error).message}`);
        return 2;
    }
    let result: DiffResult;
    try {
        result = compareScreenshots(parsed.baseline, parsed.candidate, parsed.tolerance);
    } catch (err) {
        console.error(`[screenshot-diff] ${(err as Error).message}`);
        return 2;
    }
    if (parsed.json) {
        console.log(JSON.stringify(result, null, 2));
    } else {
        console.log(formatHuman(result));
    }
    return result.match ? 0 : 1;
}

if (import.meta.main) {
    process.exit(main());
}

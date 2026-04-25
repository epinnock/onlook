#!/usr/bin/env bun
/**
 * screenshot-diff.ts — three-tier screenshot-pair comparison for CI.
 *
 * Purpose: give MCG.11's real-relay E2E a pass/fail signal against the two
 * baseline screenshots at `plans/adr/assets/v2-pipeline/v2r-{hello,updated}.png`.
 * Ships without an imagemagick / sharp dependency — compares in order:
 *   1. sha256       — exact-match gate (fastest, highest confidence when it passes)
 *   2. perceptual   — pure-TS PNG decode + per-pixel RGBA diff ratio (MCG.9 / #99)
 *   3. size         — coarse file-size fallback, for non-PNG inputs or decode failures
 *
 * Usage:
 *   bun run scripts/screenshot-diff.ts <baseline> <candidate> [--tolerance 0.05]
 *   bun run scripts/screenshot-diff.ts baseline.png candidate.png --json
 *   bun run scripts/screenshot-diff.ts baseline.png candidate.png --no-perceptual
 *
 * Exit codes:
 *   0 — match (hash OR perceptual OR size-delta within tolerance)
 *   1 — mismatch (beyond tolerance on all tiers)
 *   2 — usage / I/O error
 *
 * When `--perceptual-threshold` is supplied (0–1, default 0.02 = 2%), the
 * perceptual tier matches when the RGBA pixel-delta ratio is below it.
 * The coarser `--tolerance` flag drives the size-tier fallback only.
 */

import { createHash } from 'node:crypto';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { basename, resolve } from 'node:path';

import { decodePng, perceptualDiff, PngDecodeError } from './pngDecoder';

export type DiffTier = 'hash' | 'perceptual' | 'size' | 'mismatch';

export type DiffResult = {
    match: boolean;
    tier: DiffTier;
    baseline: { path: string; bytes: number; sha256: string };
    candidate: { path: string; bytes: number; sha256: string };
    sizeDeltaBytes: number;
    sizeDeltaRatio: number;
    tolerance: number;
    /** Filled in when the perceptual tier ran. */
    perceptualRatio?: number;
    /** Filled in when the perceptual tier ran. */
    perceptualThreshold?: number;
    reason: string;
};

export function sha256(buf: Buffer): string {
    return createHash('sha256').update(buf).digest('hex');
}

export type CompareOptions = {
    /** Size-tier fallback tolerance (0–1). Default 0.05. */
    tolerance?: number;
    /** Perceptual pixel-delta ratio threshold (0–1). Default 0.02. */
    perceptualThreshold?: number;
    /** Disable the perceptual tier (useful when inputs aren't PNGs). Default false. */
    noPerceptual?: boolean;
    /** Per-channel delta (0–255) above which a pixel counts as different. Default 16. */
    channelThreshold?: number;
};

export function compareScreenshots(
    baselinePath: string,
    candidatePath: string,
    toleranceOrOptions: number | CompareOptions,
): DiffResult {
    const opts: CompareOptions =
        typeof toleranceOrOptions === 'number'
            ? { tolerance: toleranceOrOptions }
            : toleranceOrOptions;
    const tolerance = opts.tolerance ?? 0.05;
    const perceptualThreshold = opts.perceptualThreshold ?? 0.02;
    const noPerceptual = opts.noPerceptual ?? false;
    const channelThreshold = opts.channelThreshold ?? 16;

    if (tolerance < 0 || tolerance > 1) {
        throw new Error(`tolerance must be in [0, 1]; got ${tolerance}`);
    }
    if (perceptualThreshold < 0 || perceptualThreshold > 1) {
        throw new Error(`perceptualThreshold must be in [0, 1]; got ${perceptualThreshold}`);
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

    // Perceptual tier: decode both PNGs, compare RGBA pixel-delta ratio.
    if (!noPerceptual) {
        try {
            const a = decodePng(baselineBuf);
            const b = decodePng(candidateBuf);
            const diff = perceptualDiff(a, b, channelThreshold);
            if (diff.diffRatio <= perceptualThreshold) {
                return {
                    ...baseResult,
                    match: true,
                    tier: 'perceptual',
                    perceptualRatio: diff.diffRatio,
                    perceptualThreshold,
                    reason: `pixel delta ${(diff.diffRatio * 100).toFixed(3)}% ≤ ${(perceptualThreshold * 100).toFixed(2)}% (${diff.diffPixels} / ${diff.totalPixels} px)`,
                };
            }
            return {
                ...baseResult,
                match: false,
                tier: 'mismatch',
                perceptualRatio: diff.diffRatio,
                perceptualThreshold,
                reason: `pixel delta ${(diff.diffRatio * 100).toFixed(3)}% exceeds ${(perceptualThreshold * 100).toFixed(2)}% (${diff.diffPixels} / ${diff.totalPixels} px)`,
            };
        } catch (err) {
            // PNG decode failed — fall through to size-tier heuristic. This
            // can happen if the input isn't a PNG, the dimensions differ
            // (the decoder throws on that — returned as mismatch below), or
            // a malformed file lands in CI.
            if (err instanceof PngDecodeError && /dimension mismatch/.test(err.message)) {
                return {
                    ...baseResult,
                    match: false,
                    tier: 'mismatch',
                    reason: err.message,
                };
            }
            // Any other decode error — silently drop to the size tier so the
            // CLI still produces a usable answer on non-PNG inputs.
        }
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
    perceptualThreshold: number;
    noPerceptual: boolean;
    json: boolean;
};

function parseNumericFlag(arg: string, next: string | undefined, flagName: string): { value: number; advanced: boolean } {
    if (arg.includes('=')) {
        const v = Number(arg.slice(arg.indexOf('=') + 1));
        if (!Number.isFinite(v)) throw new Error(`${flagName} must be numeric; got ${arg}`);
        return { value: v, advanced: false };
    }
    if (next === undefined) throw new Error(`${flagName} requires a value`);
    const v = Number(next);
    if (!Number.isFinite(v)) throw new Error(`${flagName} must be numeric; got ${next}`);
    return { value: v, advanced: true };
}

export function parseArgs(argv: readonly string[]): ParsedArgs {
    const positional: string[] = [];
    let tolerance = 0.05;
    let perceptualThreshold = 0.02;
    let noPerceptual = false;
    let json = false;
    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i] ?? '';
        if (arg === '--tolerance' || arg.startsWith('--tolerance=')) {
            const { value, advanced } = parseNumericFlag(arg, argv[i + 1], '--tolerance');
            tolerance = value;
            if (advanced) i += 1;
        } else if (arg === '--perceptual-threshold' || arg.startsWith('--perceptual-threshold=')) {
            const { value, advanced } = parseNumericFlag(arg, argv[i + 1], '--perceptual-threshold');
            perceptualThreshold = value;
            if (advanced) i += 1;
        } else if (arg === '--no-perceptual') {
            noPerceptual = true;
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
            `usage: screenshot-diff.ts <baseline> <candidate> [--tolerance N] [--perceptual-threshold N] [--no-perceptual] [--json]; got ${positional.length} positional args`,
        );
    }
    return {
        baseline: resolve(positional[0] ?? ''),
        candidate: resolve(positional[1] ?? ''),
        tolerance,
        perceptualThreshold,
        noPerceptual,
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
        result = compareScreenshots(parsed.baseline, parsed.candidate, {
            tolerance: parsed.tolerance,
            perceptualThreshold: parsed.perceptualThreshold,
            noPerceptual: parsed.noPerceptual,
        });
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

/**
 * Pure size-gate checker for ABI v1 overlays. Mirrors the soft/hard cap
 * thresholds enforced by `wrapOverlayV1` so callers can run the same gate
 * outside the bundler — typically in CI to fail a build when an overlay
 * crosses the hard cap, or to surface a soft-cap warning earlier than the
 * runtime would.
 *
 * Pure: no Node/Bun-specific globals. Designed for both `bun bin` scripts
 * and inline use from a Cloudflare Worker that wants to gate uploads.
 */

import { OVERLAY_SIZE_HARD_CAP, OVERLAY_SIZE_SOFT_CAP } from './wrap-overlay-v1';

export type OverlaySizeStatus = 'ok' | 'warn-soft' | 'fail-hard';

export interface OverlaySizeCheckResult {
    readonly status: OverlaySizeStatus;
    readonly bytes: number;
    readonly softCap: number;
    readonly hardCap: number;
    readonly message: string;
}

export interface CheckOverlaySizeOptions {
    /**
     * Override the soft cap (e.g. tighter dev-time gate). Defaults to
     * `OVERLAY_SIZE_SOFT_CAP` from `wrap-overlay-v1.ts`.
     */
    readonly softCap?: number;
    /**
     * Override the hard cap. Defaults to `OVERLAY_SIZE_HARD_CAP`.
     */
    readonly hardCap?: number;
}

export function checkOverlaySize(
    bundle: string | Uint8Array,
    options: CheckOverlaySizeOptions = {},
): OverlaySizeCheckResult {
    const softCap = options.softCap ?? OVERLAY_SIZE_SOFT_CAP;
    const hardCap = options.hardCap ?? OVERLAY_SIZE_HARD_CAP;

    if (softCap >= hardCap) {
        throw new Error(
            `checkOverlaySize: softCap (${softCap}) must be less than hardCap (${hardCap})`,
        );
    }

    const bytes = byteLengthOf(bundle);

    if (bytes > hardCap) {
        return {
            status: 'fail-hard',
            bytes,
            softCap,
            hardCap,
            message: `Overlay bundle is ${bytes} bytes, which exceeds the hard cap of ${hardCap} bytes (${formatPercent(bytes, hardCap)} of cap). Reduce overlay size or split the change into smaller updates before deploying.`,
        };
    }

    if (bytes > softCap) {
        return {
            status: 'warn-soft',
            bytes,
            softCap,
            hardCap,
            message: `Overlay bundle is ${bytes} bytes, above the soft cap of ${softCap} bytes (${formatPercent(bytes, softCap)} of cap). Consider trimming before approaching the hard cap of ${hardCap}.`,
        };
    }

    return {
        status: 'ok',
        bytes,
        softCap,
        hardCap,
        message: `Overlay bundle is ${bytes} bytes (${formatPercent(bytes, softCap)} of soft cap).`,
    };
}

function byteLengthOf(bundle: string | Uint8Array): number {
    if (typeof bundle === 'string') {
        // Account for multi-byte chars — wire size is the UTF-8 encoded byte length.
        return new TextEncoder().encode(bundle).byteLength;
    }
    return bundle.byteLength;
}

function formatPercent(numerator: number, denominator: number): string {
    if (denominator === 0) return '∞%';
    const pct = (numerator / denominator) * 100;
    return `${pct.toFixed(1)}%`;
}

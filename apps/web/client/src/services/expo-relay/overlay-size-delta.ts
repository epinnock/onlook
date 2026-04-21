/**
 * Overlay size-delta telemetry — task perf-size-diff.
 *
 * Tracks the byte delta between consecutive overlay builds so editor UI can
 * warn when an overlay balloons (usually a regression — user accidentally
 * imported a large module, or pulled a package artifact into the user graph
 * instead of the base bundle).
 */

export type OverlaySizeCategory = 'shrunk' | 'grew' | 'unchanged';

export interface OverlaySizeDelta {
    readonly previousBytes: number;
    readonly currentBytes: number;
    readonly absoluteDeltaBytes: number;
    readonly percentDelta: number;
    readonly category: OverlaySizeCategory;
}

/**
 * Compute the delta between two overlay builds. Returns {absolute,
 * percent, category} so UIs can render either the raw bytes (for
 * power users) or a human-friendly "+45% larger" label.
 *
 * When the previous size was 0 (first-ever overlay), percentDelta is
 * reported as `Infinity` — caller should special-case first-build display.
 */
export function computeOverlaySizeDelta(
    previousBytes: number,
    currentBytes: number,
): OverlaySizeDelta {
    const absoluteDeltaBytes = currentBytes - previousBytes;
    const percentDelta =
        previousBytes === 0
            ? currentBytes === 0
                ? 0
                : Number.POSITIVE_INFINITY
            : (absoluteDeltaBytes / previousBytes) * 100;
    const category: OverlaySizeCategory =
        absoluteDeltaBytes === 0
            ? 'unchanged'
            : absoluteDeltaBytes > 0
                ? 'grew'
                : 'shrunk';

    return {
        previousBytes,
        currentBytes,
        absoluteDeltaBytes,
        percentDelta,
        category,
    };
}

/** Threshold (percent) above which a grow delta deserves an editor warning. */
export const OVERLAY_SIZE_GROW_WARN_PERCENT = 20;
/** Threshold (bytes) above which a shrink delta deserves an info-log. */
export const OVERLAY_SIZE_SHRINK_INFO_BYTES = 10 * 1024;

export function shouldWarnOnSizeDelta(delta: OverlaySizeDelta): boolean {
    if (delta.category !== 'grew') return false;
    if (!Number.isFinite(delta.percentDelta)) return false;
    return delta.percentDelta >= OVERLAY_SIZE_GROW_WARN_PERCENT;
}

export function shouldInfoLogSizeDelta(delta: OverlaySizeDelta): boolean {
    if (delta.category !== 'shrunk') return false;
    return Math.abs(delta.absoluteDeltaBytes) >= OVERLAY_SIZE_SHRINK_INFO_BYTES;
}

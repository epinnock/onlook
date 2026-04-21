import { describe, expect, test } from 'bun:test';

import {
    OVERLAY_SIZE_GROW_WARN_PERCENT,
    computeOverlaySizeDelta,
    shouldInfoLogSizeDelta,
    shouldWarnOnSizeDelta,
} from '../overlay-size-delta';

describe('overlay-size-delta / computeOverlaySizeDelta', () => {
    test('positive delta reports grew category with absolute + percent', () => {
        const d = computeOverlaySizeDelta(1000, 1500);
        expect(d.category).toBe('grew');
        expect(d.absoluteDeltaBytes).toBe(500);
        expect(d.percentDelta).toBe(50);
    });

    test('negative delta reports shrunk', () => {
        const d = computeOverlaySizeDelta(1000, 400);
        expect(d.category).toBe('shrunk');
        expect(d.absoluteDeltaBytes).toBe(-600);
        expect(d.percentDelta).toBe(-60);
    });

    test('zero delta reports unchanged', () => {
        const d = computeOverlaySizeDelta(1000, 1000);
        expect(d.category).toBe('unchanged');
        expect(d.percentDelta).toBe(0);
    });

    test('first-ever overlay (previousBytes=0, current>0) reports Infinity percent', () => {
        const d = computeOverlaySizeDelta(0, 1000);
        expect(d.category).toBe('grew');
        expect(d.percentDelta).toBe(Number.POSITIVE_INFINITY);
    });

    test('both-zero reports 0 percent (edge case, unchanged)', () => {
        const d = computeOverlaySizeDelta(0, 0);
        expect(d.category).toBe('unchanged');
        expect(d.percentDelta).toBe(0);
    });
});

describe('overlay-size-delta / shouldWarnOnSizeDelta', () => {
    test('triggers at or above threshold', () => {
        const d = computeOverlaySizeDelta(1000, 1000 + 1000 * (OVERLAY_SIZE_GROW_WARN_PERCENT / 100));
        expect(shouldWarnOnSizeDelta(d)).toBe(true);
    });

    test('does not trigger under threshold', () => {
        const d = computeOverlaySizeDelta(1000, 1100); // 10% grow
        expect(shouldWarnOnSizeDelta(d)).toBe(false);
    });

    test('does not trigger for shrinks', () => {
        expect(shouldWarnOnSizeDelta(computeOverlaySizeDelta(1000, 500))).toBe(false);
    });

    test('does not trigger for first-ever (Infinity — gets special-cased in UI)', () => {
        expect(shouldWarnOnSizeDelta(computeOverlaySizeDelta(0, 1000))).toBe(false);
    });
});

describe('overlay-size-delta / shouldInfoLogSizeDelta', () => {
    test('triggers on shrinks over the byte threshold', () => {
        const d = computeOverlaySizeDelta(100_000, 80_000);
        expect(shouldInfoLogSizeDelta(d)).toBe(true);
    });

    test('does not trigger on small shrinks', () => {
        const d = computeOverlaySizeDelta(100, 50);
        expect(shouldInfoLogSizeDelta(d)).toBe(false);
    });

    test('does not trigger on growth', () => {
        expect(shouldInfoLogSizeDelta(computeOverlaySizeDelta(100, 1000))).toBe(false);
    });
});

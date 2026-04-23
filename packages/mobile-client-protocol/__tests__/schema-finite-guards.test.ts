/**
 * Schema finite-number guards — regression locks for the Infinity
 * sanitization pass (commit de08002f + siblings).
 *
 * Zod's `z.number()` accepts `Infinity` by default; any numeric field
 * that aggregates into an editor-side dashboard (p95, mean) or drives
 * a layout computation can't afford that silent poison. This file
 * asserts every numeric field known to be soak- or layout-sensitive
 * rejects `Infinity` + `NaN` at the schema boundary.
 */
import { describe, expect, test } from 'bun:test';

import { RectSchema } from '../src/inspector';
import { NetworkMessageSchema } from '../src/ws-messages';

describe('RectSchema — finite guards', () => {
    const validRect = { x: 0, y: 0, width: 100, height: 50 };

    test('accepts finite values', () => {
        expect(RectSchema.safeParse(validRect).success).toBe(true);
    });

    test('rejects Infinity on every field', () => {
        for (const key of ['x', 'y', 'width', 'height'] as const) {
            expect(
                RectSchema.safeParse({ ...validRect, [key]: Infinity }).success,
            ).toBe(false);
        }
    });

    test('rejects NaN on every field', () => {
        for (const key of ['x', 'y', 'width', 'height'] as const) {
            expect(
                RectSchema.safeParse({ ...validRect, [key]: NaN }).success,
            ).toBe(false);
        }
    });

    test('rejects -Infinity on width/height (also negative)', () => {
        // width/height have a .nonnegative() that already catches
        // -Infinity; this double-checks the schema doesn't weaken if
        // the finite guard is moved elsewhere in the chain.
        expect(
            RectSchema.safeParse({ ...validRect, width: -Infinity }).success,
        ).toBe(false);
        expect(
            RectSchema.safeParse({ ...validRect, height: -Infinity }).success,
        ).toBe(false);
    });

    test('rejects -Infinity on x/y (only finite guard catches this)', () => {
        // x/y have no sign constraint — the finite guard is the ONLY
        // thing blocking -Infinity. This test fails if the guard is
        // removed in a future edit.
        expect(
            RectSchema.safeParse({ ...validRect, x: -Infinity }).success,
        ).toBe(false);
        expect(
            RectSchema.safeParse({ ...validRect, y: -Infinity }).success,
        ).toBe(false);
    });
});

describe('NetworkMessageSchema — durationMs finite guard', () => {
    const valid = {
        type: 'onlook:network' as const,
        sessionId: 's',
        requestId: 'r',
        method: 'GET',
        url: 'https://example.com/x',
        phase: 'end' as const,
        timestamp: 1_712_000_000_000,
    };

    test('accepts a finite durationMs', () => {
        expect(
            NetworkMessageSchema.safeParse({ ...valid, durationMs: 42 })
                .success,
        ).toBe(true);
    });

    test('accepts an absent durationMs (optional)', () => {
        expect(NetworkMessageSchema.safeParse(valid).success).toBe(true);
    });

    test('rejects Infinity durationMs (would poison p95 in MobileNetworkTab)', () => {
        expect(
            NetworkMessageSchema.safeParse({ ...valid, durationMs: Infinity })
                .success,
        ).toBe(false);
    });

    test('rejects NaN durationMs', () => {
        expect(
            NetworkMessageSchema.safeParse({ ...valid, durationMs: NaN })
                .success,
        ).toBe(false);
    });
});

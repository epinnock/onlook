import { describe, expect, test } from 'bun:test';

import {
    BUILD_SLOW_MS,
    PUSH_SLOW_MS,
    evaluateBuildDuration,
    evaluatePushTelemetry,
    evaluateSizeDelta,
    type PerfGuardrailEvent,
} from '../perf-guardrails';
import {
    OVERLAY_SIZE_GROW_WARN_PERCENT,
    OVERLAY_SIZE_SHRINK_INFO_BYTES,
} from '../overlay-size-delta';

describe('perf-guardrails / evaluatePushTelemetry', () => {
    test('emits push-slow warning when durationMs exceeds threshold', () => {
        const events: PerfGuardrailEvent[] = [];
        evaluatePushTelemetry(
            {
                sessionId: 's',
                attempts: 1,
                durationMs: PUSH_SLOW_MS + 100,
                bytes: 100,
                ok: true,
                delivered: 1,
            },
            (e) => events.push(e),
        );
        expect(events).toHaveLength(1);
        expect(events[0]?.category).toBe('push-slow');
        expect(events[0]?.severity).toBe('warn');
    });

    test('does not warn when under threshold', () => {
        const events: PerfGuardrailEvent[] = [];
        evaluatePushTelemetry(
            {
                sessionId: 's',
                attempts: 1,
                durationMs: 10,
                bytes: 100,
                ok: true,
                delivered: 1,
            },
            (e) => events.push(e),
        );
        expect(events).toHaveLength(0);
    });

    test('emits push-retried info when attempts > 1 (even on success)', () => {
        const events: PerfGuardrailEvent[] = [];
        evaluatePushTelemetry(
            {
                sessionId: 's',
                attempts: 3,
                durationMs: 50,
                bytes: 100,
                ok: true,
                delivered: 1,
            },
            (e) => events.push(e),
        );
        expect(events).toHaveLength(1);
        expect(events[0]?.category).toBe('push-retried');
        expect(events[0]?.severity).toBe('info');
    });

    test('failed push does NOT trigger push-slow warning (slow-but-broken is a different story)', () => {
        const events: PerfGuardrailEvent[] = [];
        evaluatePushTelemetry(
            {
                sessionId: 's',
                attempts: 3,
                durationMs: PUSH_SLOW_MS + 500,
                bytes: 100,
                ok: false,
                error: 'ECONNREFUSED',
            },
            (e) => events.push(e),
        );
        // Only retries event, not slow-push.
        expect(events.map((e) => e.category)).toEqual(['push-retried']);
    });

    test('defensive: Infinity durationMs does NOT emit push-slow (would poison dashboard)', () => {
        const events: PerfGuardrailEvent[] = [];
        evaluatePushTelemetry(
            {
                sessionId: 's',
                attempts: 1,
                durationMs: Infinity,
                bytes: 100,
                ok: true,
                delivered: 1,
            },
            (e) => events.push(e),
        );
        expect(events).toHaveLength(0);
    });

    test('defensive: NaN durationMs does NOT emit push-slow', () => {
        const events: PerfGuardrailEvent[] = [];
        evaluatePushTelemetry(
            {
                sessionId: 's',
                attempts: 1,
                durationMs: NaN,
                bytes: 100,
                ok: true,
                delivered: 1,
            },
            (e) => events.push(e),
        );
        expect(events).toHaveLength(0);
    });
});

describe('perf-guardrails / evaluateBuildDuration', () => {
    test('warns when build exceeds BUILD_SLOW_MS', () => {
        let emitted: PerfGuardrailEvent | null = null;
        evaluateBuildDuration(BUILD_SLOW_MS + 200, (e) => {
            emitted = e;
        });
        expect(emitted).not.toBeNull();
        const nonNull = emitted as unknown as PerfGuardrailEvent;
        expect(nonNull.category).toBe('build-slow');
        expect(nonNull.message).toContain('ms');
    });

    test('does not warn when build is under budget', () => {
        let emitted: PerfGuardrailEvent | null = null;
        evaluateBuildDuration(50, (e) => {
            emitted = e;
        });
        expect(emitted).toBeNull();
    });

    test('defensive: Infinity build duration does NOT emit', () => {
        // Without the Number.isFinite guard, `Infinity > BUILD_SLOW_MS` is
        // true and `.toFixed(0)` produces "Infinity" in the message —
        // emit-blocked at the top of the function now.
        let emitted: PerfGuardrailEvent | null = null;
        evaluateBuildDuration(Infinity, (e) => {
            emitted = e;
        });
        expect(emitted).toBeNull();
    });

    test('defensive: NaN build duration does NOT emit', () => {
        // `NaN <= BUILD_SLOW_MS` is false (NaN comparisons always false)
        // so the old code would have fallen through to emit. Guard
        // catches it.
        let emitted: PerfGuardrailEvent | null = null;
        evaluateBuildDuration(NaN, (e) => {
            emitted = e;
        });
        expect(emitted).toBeNull();
    });
});

describe('perf-guardrails / evaluateSizeDelta', () => {
    test('emits size-grew warn when current bytes are >= warn% larger than previous', () => {
        // 100 → 130 = 30% jump, above the 20% warn threshold.
        const events: PerfGuardrailEvent[] = [];
        const result = evaluateSizeDelta(100, 130, (e) => events.push(e));
        expect(result?.category).toBe('size-grew');
        expect(result?.severity).toBe('warn');
        expect(events).toHaveLength(1);
        expect(events[0]?.detail.percentDelta).toBe(30);
        expect(events[0]?.detail.absoluteDeltaBytes).toBe(30);
    });

    test('does not warn when grow is below the warn threshold', () => {
        // 100 → 105 = 5%, below 20%.
        const events: PerfGuardrailEvent[] = [];
        const result = evaluateSizeDelta(100, 105, (e) => events.push(e));
        expect(result).toBeNull();
        expect(events).toHaveLength(0);
    });

    test('emits size-shrunk info when shrink ≥ shrink-info threshold bytes', () => {
        // Shrink 12 KB > 10 KB threshold → size-shrunk info event.
        const events: PerfGuardrailEvent[] = [];
        const previous = 100 * 1024;
        const current = previous - (OVERLAY_SIZE_SHRINK_INFO_BYTES + 2000);
        const result = evaluateSizeDelta(previous, current, (e) => events.push(e));
        expect(result?.category).toBe('size-shrunk');
        expect(result?.severity).toBe('info');
        expect(events).toHaveLength(1);
        expect((events[0]?.detail.absoluteDeltaBytes as number) < 0).toBe(true);
    });

    test('does not info-log when shrink is below the threshold', () => {
        // Shrink 1 KB < 10 KB threshold.
        const events: PerfGuardrailEvent[] = [];
        const result = evaluateSizeDelta(50_000, 49_000, (e) => events.push(e));
        expect(result).toBeNull();
        expect(events).toHaveLength(0);
    });

    test('previousBytes=null skips emission (first push of session)', () => {
        const events: PerfGuardrailEvent[] = [];
        const result = evaluateSizeDelta(null, 1_000_000, (e) => events.push(e));
        expect(result).toBeNull();
        expect(events).toHaveLength(0);
    });

    test('warn boundary: exactly OVERLAY_SIZE_GROW_WARN_PERCENT does emit', () => {
        // 100 → 120 = exactly 20% — boundary inclusive per shouldWarnOnSizeDelta (`>=`).
        const events: PerfGuardrailEvent[] = [];
        const result = evaluateSizeDelta(100, 120, (e) => events.push(e));
        expect(result?.category).toBe('size-grew');
        expect(result?.detail.percentDelta).toBe(OVERLAY_SIZE_GROW_WARN_PERCENT);
    });

    test('defensive: NaN previous bytes does NOT emit (would poison dashboard)', () => {
        const events: PerfGuardrailEvent[] = [];
        const result = evaluateSizeDelta(NaN, 1000, (e) => events.push(e));
        expect(result).toBeNull();
    });

    test('defensive: Infinity current bytes does NOT emit', () => {
        const events: PerfGuardrailEvent[] = [];
        const result = evaluateSizeDelta(1000, Infinity, (e) => events.push(e));
        expect(result).toBeNull();
    });

    test('defensive: negative bytes do NOT emit', () => {
        const events: PerfGuardrailEvent[] = [];
        const result = evaluateSizeDelta(-1, 100, (e) => events.push(e));
        expect(result).toBeNull();
        const result2 = evaluateSizeDelta(100, -1, (e) => events.push(e));
        expect(result2).toBeNull();
    });
});

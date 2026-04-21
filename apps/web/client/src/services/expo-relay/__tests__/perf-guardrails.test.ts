import { describe, expect, test } from 'bun:test';

import {
    BUILD_SLOW_MS,
    PUSH_SLOW_MS,
    evaluateBuildDuration,
    evaluatePushTelemetry,
    type PerfGuardrailEvent,
} from '../perf-guardrails';

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
});

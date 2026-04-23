/**
 * Tests for the Phase 11b soak sink.
 *
 * Covers:
 *   - PostHog capture: event name + payload shape for push + perf.
 *   - Console fallback: fires regardless of PostHog state so dev output
 *     is preserved.
 *   - Pipeline segmentation: the legacy and v1 branches emit distinct
 *     `pipeline` tags — the primary dimension the Phase 11b dashboard
 *     segments on.
 *   - Fault tolerance: a throwing `posthog.capture` must not throw out of
 *     the sink — the overlay push path must be unaffected.
 *   - PostHog absence: `globalThis.posthog` undefined (SSR / test harness)
 *     skips capture cleanly.
 */

import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';

import type { PushOverlayTelemetry } from '../push-overlay';
import type { PerfGuardrailEvent } from '../perf-guardrails';

import {
    emitOverlayPerfGuardrail,
    emitOverlayPushTelemetry,
    OVERLAY_PERF_EVENT,
    OVERLAY_PUSH_EVENT,
} from '../overlay-telemetry-sink';

type GlobalWithPostHog = typeof globalThis & {
    posthog?: { capture: (event: string, props?: Record<string, unknown>) => void };
};

function installMockPostHog() {
    const capture = mock((_event: string, _props?: Record<string, unknown>) => {});
    (globalThis as GlobalWithPostHog).posthog = { capture };
    return capture;
}

function uninstallPostHog() {
    delete (globalThis as GlobalWithPostHog).posthog;
}

const stubbedConsole: { info: typeof console.info; warn: typeof console.warn } = {
    info: console.info,
    warn: console.warn,
};

beforeEach(() => {
    // Silence the preserved console output so the test runner's log isn't
    // flooded; each test still asserts the capture payload through the mock.
    console.info = mock(() => {}) as typeof console.info;
    console.warn = mock(() => {}) as typeof console.warn;
});

afterEach(() => {
    uninstallPostHog();
    console.info = stubbedConsole.info;
    console.warn = stubbedConsole.warn;
});

const samplePush: PushOverlayTelemetry = {
    sessionId: 'sess-123',
    attempts: 1,
    durationMs: 42,
    bytes: 4096,
    delivered: 1,
    status: 202,
    ok: true,
};

const failedPush: PushOverlayTelemetry = {
    sessionId: 'sess-456',
    attempts: 3,
    durationMs: 1200,
    bytes: 8192,
    status: 500,
    ok: false,
    error: 'relay responded 500',
};

describe('emitOverlayPushTelemetry', () => {
    test('captures through posthog with pipeline tag and flattened payload', () => {
        const capture = installMockPostHog();
        emitOverlayPushTelemetry('overlay-v1', samplePush);

        expect(capture).toHaveBeenCalledTimes(1);
        const [eventName, props] = capture.mock.calls[0]!;
        expect(eventName).toBe(OVERLAY_PUSH_EVENT);
        expect(props).toEqual({
            pipeline: 'overlay-v1',
            sessionId: 'sess-123',
            attempts: 1,
            durationMs: 42,
            bytes: 4096,
            delivered: 1,
            status: 202,
            ok: true,
            error: undefined,
        });
    });

    test('legacy and v1 pipeline tags segment cleanly', () => {
        const capture = installMockPostHog();
        emitOverlayPushTelemetry('overlay-legacy', samplePush);
        emitOverlayPushTelemetry('overlay-v1', samplePush);

        expect(capture).toHaveBeenCalledTimes(2);
        expect(capture.mock.calls[0]![1]!.pipeline).toBe('overlay-legacy');
        expect(capture.mock.calls[1]![1]!.pipeline).toBe('overlay-v1');
    });

    test('forwards failure telemetry with error field', () => {
        const capture = installMockPostHog();
        emitOverlayPushTelemetry('overlay-v1', failedPush);

        const props = capture.mock.calls[0]![1];
        expect(props!.ok).toBe(false);
        expect(props!.error).toBe('relay responded 500');
        expect(props!.attempts).toBe(3);
    });

    test('logs to console.info even when posthog is absent', () => {
        uninstallPostHog();
        emitOverlayPushTelemetry('overlay-legacy', samplePush);
        expect(console.info).toHaveBeenCalledTimes(1);
    });

    test('swallows posthog.capture throws without affecting caller', () => {
        (globalThis as GlobalWithPostHog).posthog = {
            capture: () => {
                throw new Error('posthog exploded');
            },
        };
        // Must not throw — the overlay push caller depends on this.
        expect(() =>
            emitOverlayPushTelemetry('overlay-v1', samplePush),
        ).not.toThrow();
    });

    test('tolerates a non-posthog-shaped global', () => {
        (globalThis as unknown as Record<string, unknown>).posthog = {
            notCapture: 1,
        };
        expect(() =>
            emitOverlayPushTelemetry('overlay-v1', samplePush),
        ).not.toThrow();
    });
});

describe('emitOverlayPerfGuardrail', () => {
    const warnEvent: PerfGuardrailEvent = {
        category: 'push-slow',
        severity: 'warn',
        message: 'overlay push took 800ms (budget 500ms)',
        detail: { sessionId: 'sess-1', durationMs: 800, bytes: 1024 },
    };
    const infoEvent: PerfGuardrailEvent = {
        category: 'push-retried',
        severity: 'info',
        message: 'overlay push retried 2 time(s)',
        detail: { sessionId: 'sess-1', attempts: 3, ok: true },
    };

    test('captures warn events with flattened detail', () => {
        const capture = installMockPostHog();
        emitOverlayPerfGuardrail('overlay-v1', warnEvent);

        const [eventName, props] = capture.mock.calls[0]!;
        expect(eventName).toBe(OVERLAY_PERF_EVENT);
        expect(props).toEqual({
            pipeline: 'overlay-v1',
            category: 'push-slow',
            severity: 'warn',
            message: 'overlay push took 800ms (budget 500ms)',
            sessionId: 'sess-1',
            durationMs: 800,
            bytes: 1024,
        });
        expect(console.warn).toHaveBeenCalledTimes(1);
    });

    test('info events go through console.info, not console.warn', () => {
        installMockPostHog();
        emitOverlayPerfGuardrail('overlay-legacy', infoEvent);
        expect(console.info).toHaveBeenCalledTimes(1);
        expect(console.warn).not.toHaveBeenCalled();
    });

    test('swallows posthog.capture throws on perf path too', () => {
        (globalThis as GlobalWithPostHog).posthog = {
            capture: () => {
                throw new Error('perf capture boom');
            },
        };
        expect(() =>
            emitOverlayPerfGuardrail('overlay-v1', warnEvent),
        ).not.toThrow();
    });
});

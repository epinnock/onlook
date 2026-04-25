/**
 * Performance guardrails — task #99 runtime instrumentation.
 *
 * Surfaces soft-warnings when the overlay pipeline crosses ADR-defined
 * thresholds. These never throw — they emit structured telemetry the editor
 * UI can render as a subtle warning without blocking the push.
 *
 * Targets (from ADR-0001 §"Performance envelope"):
 *   - Overlay source size:   512 KB soft / 2 MB hard (enforced in wrap-overlay-v1).
 *   - Overlay eval on device: ≤100 ms on a 2-year-old iPhone.
 *   - Build time:             ≤1000 ms (trailing debounce + esbuild in the editor).
 *   - Push latency:           ≤500 ms to relay.
 */
import type { PushOverlayTelemetry } from './push-overlay';

export const BUILD_SLOW_MS = 1000;
export const PUSH_SLOW_MS = 500;

export type PerfGuardrailCategory =
    | 'build-slow'
    | 'push-slow'
    | 'push-retried'
    | 'large-overlay';

export interface PerfGuardrailEvent {
    readonly category: PerfGuardrailCategory;
    readonly severity: 'info' | 'warn';
    readonly message: string;
    readonly detail: Readonly<Record<string, unknown>>;
}

export type PerfGuardrailSink = (event: PerfGuardrailEvent) => void;

/** Emit a structured console warning sink — the default when no explicit sink is wired. */
export const DEFAULT_PERF_SINK: PerfGuardrailSink = (event) => {
    if (event.severity === 'warn') {
        // eslint-disable-next-line no-console
        console.warn('[onlook.perf]', event);
    } else {
        // eslint-disable-next-line no-console
        console.info('[onlook.perf]', event);
    }
};

/**
 * Inspect a pushOverlayV1 telemetry event and emit guardrail events when
 * thresholds are crossed. Returns the list of events emitted so callers can
 * accumulate them for their own telemetry pipelines.
 */
export function evaluatePushTelemetry(
    telemetry: PushOverlayTelemetry,
    sink: PerfGuardrailSink = DEFAULT_PERF_SINK,
): readonly PerfGuardrailEvent[] {
    const events: PerfGuardrailEvent[] = [];
    // `Number.isFinite` filters NaN + ±Infinity. Currently `pushOverlay`
    // measures durationMs via `performance.now()` which is always finite,
    // but keeping the guard defensive so a future phone-round-tripped
    // duration or a test harness injecting a broken clock can't emit a
    // guardrail event with Infinity in the detail.
    if (
        Number.isFinite(telemetry.durationMs) &&
        telemetry.durationMs > PUSH_SLOW_MS &&
        telemetry.ok
    ) {
        events.push({
            category: 'push-slow',
            severity: 'warn',
            message: `overlay push took ${telemetry.durationMs.toFixed(0)}ms (budget ${PUSH_SLOW_MS}ms)`,
            detail: {
                sessionId: telemetry.sessionId,
                durationMs: telemetry.durationMs,
                bytes: telemetry.bytes,
            },
        });
    }
    if (telemetry.attempts > 1) {
        events.push({
            category: 'push-retried',
            severity: 'info',
            message: `overlay push retried ${telemetry.attempts - 1} time(s)`,
            detail: {
                sessionId: telemetry.sessionId,
                attempts: telemetry.attempts,
                ok: telemetry.ok,
            },
        });
    }
    for (const event of events) sink(event);
    return events;
}

/**
 * Evaluate a build duration against the slow-build threshold. Caller passes
 * the wall-clock duration of their overlay-bundler build step; we emit a
 * warning if it's over budget. Returns null if no warning was emitted.
 */
export function evaluateBuildDuration(
    durationMs: number,
    sink: PerfGuardrailSink = DEFAULT_PERF_SINK,
): PerfGuardrailEvent | null {
    // Defensive: don't emit a guardrail with NaN/Infinity in the detail.
    // `<=` against NaN is `false` so NaN would pass through and fire the
    // warning; `.toFixed(0)` on Infinity yields "Infinity" which would
    // land in the log and dashboard.
    if (!Number.isFinite(durationMs)) return null;
    if (durationMs <= BUILD_SLOW_MS) return null;
    const event: PerfGuardrailEvent = {
        category: 'build-slow',
        severity: 'warn',
        message: `overlay build took ${durationMs.toFixed(0)}ms (budget ${BUILD_SLOW_MS}ms)`,
        detail: { durationMs },
    };
    sink(event);
    return event;
}

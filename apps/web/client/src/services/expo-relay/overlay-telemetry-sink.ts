/**
 * overlay-telemetry-sink — durable sink for Phase 11b soak metrics.
 *
 * ADR-0009 flags the pre-requisite for the 7-day canary:
 *   > Current telemetry sinks (`pushOverlay`'s `onTelemetry` callback) are
 *   > console.info by default — promoting to a real sink is prerequisite
 *   > work.
 *
 * This module provides that sink. Every overlay push (legacy and v1) and
 * every perf-guardrail threshold crossing routes through `posthog.capture`
 * when PostHog is initialized, with console logging preserved as a
 * fallback so dev-time observability is unchanged.
 *
 * Design notes:
 *  - PostHog is browser-only. The module is tolerant of SSR/test contexts
 *    where the runtime has no window — `captureSafely` swallows every
 *    throw so a missing/broken PostHog never affects the overlay push.
 *  - A `pipeline` tag ('overlay-v1' | 'overlay-legacy') is required on
 *    every call. Phase 11b soak compares the two populations, so the tag
 *    is the primary dimension PostHog segments on.
 *  - The module does NOT import posthog-js at module-scope. It resolves
 *    `globalThis.posthog` (what `TelemetryProvider` assigns via
 *    `posthog.init`) each call. This keeps the module usable from test
 *    files that `mock.module` the sink itself without touching posthog.
 */

import type { PerfGuardrailEvent } from './perf-guardrails';
import type { PushOverlayTelemetry } from './push-overlay';

export type OverlayPipelineTag = 'overlay-v1' | 'overlay-legacy';

export const OVERLAY_PUSH_EVENT = 'onlook_overlay_push';
export const OVERLAY_PERF_EVENT = 'onlook_overlay_perf';

interface PostHogLike {
    capture: (event: string, props?: Record<string, unknown>) => void;
}

/** Best-effort posthog resolution. Null means posthog isn't installed. */
function resolvePostHog(): PostHogLike | null {
    try {
        // PostHogProvider assigns `posthog` onto the global object indirectly
        // via posthog-js's own `init`. Access through globalThis so SSR,
        // test contexts, and browser contexts all go through the same path.
        const candidate = (globalThis as unknown as { posthog?: unknown }).posthog;
        if (
            candidate &&
            typeof candidate === 'object' &&
            'capture' in candidate &&
            typeof (candidate as PostHogLike).capture === 'function'
        ) {
            return candidate as PostHogLike;
        }
    } catch {
        // Accessing globalThis can throw in hardened sandboxes — ignore.
    }
    return null;
}

/** Fire-and-forget posthog.capture. Never throws. */
function captureSafely(event: string, props: Record<string, unknown>): void {
    const ph = resolvePostHog();
    if (!ph) return;
    try {
        ph.capture(event, props);
    } catch {
        // Telemetry sinks must never affect control flow — swallow.
    }
}

/**
 * Emit a structured console log for the overlay push. Mirrors the
 * pre-existing `DEFAULT_TELEMETRY` in `push-overlay.ts` so dev-time
 * visibility is unchanged when PostHog is absent.
 */
function logPushEvent(pipeline: OverlayPipelineTag, event: PushOverlayTelemetry): void {
    console.info('[onlook.push-overlay]', { pipeline, ...event });
}

/**
 * Route a `PushOverlayTelemetry` event through PostHog AND the console
 * sink. Call from `onTelemetry` on both `pushOverlay` and `pushOverlayV1`.
 * Returns void so callers can drop it into an arrow without ceremony.
 */
export function emitOverlayPushTelemetry(
    pipeline: OverlayPipelineTag,
    event: PushOverlayTelemetry,
): void {
    logPushEvent(pipeline, event);
    captureSafely(OVERLAY_PUSH_EVENT, {
        pipeline,
        sessionId: event.sessionId,
        attempts: event.attempts,
        durationMs: event.durationMs,
        bytes: event.bytes,
        delivered: event.delivered,
        status: event.status,
        ok: event.ok,
        error: event.error,
    });
}

/**
 * Route a `PerfGuardrailEvent` through PostHog AND the console sink.
 * Pass this as the `sink` override on `evaluatePushTelemetry`,
 * `evaluateBuildDuration`, etc. so every threshold crossing lands in
 * the soak dashboard.
 */
export function emitOverlayPerfGuardrail(
    pipeline: OverlayPipelineTag,
    event: PerfGuardrailEvent,
): void {
    if (event.severity === 'warn') {
        console.warn('[onlook.perf]', { pipeline, ...event });
    } else {
        console.info('[onlook.perf]', { pipeline, ...event });
    }
    captureSafely(OVERLAY_PERF_EVENT, {
        pipeline,
        category: event.category,
        severity: event.severity,
        message: event.message,
        ...event.detail,
    });
}

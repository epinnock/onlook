/**
 * Relay event schema — the wire contract for the phone→editor event channel
 * served by cf-expo-relay at `GET /events?session=<id>&since=<cursor>`.
 *
 * Bridgeless iOS 18.6 doesn't dispatch WebSocket `onopen` / `onmessage` back
 * to JS (ADR `v2-pipeline-validation-findings.md` finding #8). Instead of
 * WS, the mobile-client polls this endpoint via `OnlookRuntime.httpGet` (sync
 * JSI → NSURLSession) and dispatches each event to registered listeners.
 * See `packages/mobile-preview/runtime/src/relayEventPoll.ts` for the poll
 * loop and `apps/mobile-client/src/relay/overlayAckPoll.ts` for the wrapper.
 *
 * Task: MCG.10 step 2 (schema side; relay handler is follow-up work).
 *
 * Discriminated on `type`. Five event kinds — first three mirror
 * `ws-messages.ts` but flow relay→phone rather than phone→relay; the
 * overlay-specific ones are new:
 *
 *   overlayAck       — relay confirms the editor received an overlay mount
 *                      from the phone's `_onlookRenderApp` cycle. Closes
 *                      the loop on ABI v1 bidirectional observability
 *                      (task #72).
 *   bundleUpdate     — editor published a new overlay bundle; phone should
 *                      re-fetch the manifest and remount via
 *                      `OnlookRuntime.mountOverlay`. Parallel to the
 *                      WS-channel `bundleUpdate` message — same semantics
 *                      on a different transport.
 *   overlayMounted   — editor-originated signal that the latest overlay
 *                      bundle mounted successfully (used by the editor to
 *                      surface a live-reload success toast).
 *   overlayError     — editor-originated signal that the latest mount
 *                      threw. Carries the stringified error + stack.
 *   keepAlive        — empty heartbeat emitted every poll window when no
 *                      other event is pending, so the poll loop's cursor
 *                      advances and the client knows the relay is up.
 */

import { z } from 'zod';

// ─── individual event kinds ──────────────────────────────────────────────────

export const OverlayAckEventSchema = z.object({
    id: z.string().min(1),
    type: z.literal('overlayAck'),
    data: z.object({
        sessionId: z.string().min(1),
        mountedAt: z.number().int().nonnegative(),
        /** Echo of the element key OR a server-assigned ack id. */
        ackId: z.string().min(1).optional(),
    }),
});
export type OverlayAckEvent = z.infer<typeof OverlayAckEventSchema>;

export const BundleUpdateEventSchema = z.object({
    id: z.string().min(1),
    type: z.literal('bundleUpdate'),
    data: z.object({
        sessionId: z.string().min(1),
        bundleUrl: z.string().url(),
        onlookRuntimeVersion: z.string(),
        timestamp: z.number().int().nonnegative(),
    }),
});
export type BundleUpdateEvent = z.infer<typeof BundleUpdateEventSchema>;

export const OverlayMountedEventSchema = z.object({
    id: z.string().min(1),
    type: z.literal('overlayMounted'),
    data: z.object({
        sessionId: z.string().min(1),
        mountedAt: z.number().int().nonnegative(),
    }),
});
export type OverlayMountedEvent = z.infer<typeof OverlayMountedEventSchema>;

export const OverlayErrorEventSchema = z.object({
    id: z.string().min(1),
    type: z.literal('overlayError'),
    data: z.object({
        sessionId: z.string().min(1),
        message: z.string(),
        stack: z.string().optional(),
        timestamp: z.number().int().nonnegative(),
    }),
});
export type OverlayErrorEvent = z.infer<typeof OverlayErrorEventSchema>;

export const KeepAliveEventSchema = z.object({
    id: z.string().min(1),
    type: z.literal('keepAlive'),
    data: z.object({
        timestamp: z.number().int().nonnegative(),
    }),
});
export type KeepAliveEvent = z.infer<typeof KeepAliveEventSchema>;

// ─── discriminated union ─────────────────────────────────────────────────────

export const RelayEventSchema = z.discriminatedUnion('type', [
    OverlayAckEventSchema,
    BundleUpdateEventSchema,
    OverlayMountedEventSchema,
    OverlayErrorEventSchema,
    KeepAliveEventSchema,
]);
export type TypedRelayEvent = z.infer<typeof RelayEventSchema>;

// ─── response envelope ───────────────────────────────────────────────────────

/**
 * Wire response body at `GET /events`. `events` is ordered oldest-first.
 * `cursor` is whatever the relay considers the next poll's `since=` value —
 * opaque to the client; treat as a string.
 */
export const RelayEventsResponseSchema = z.object({
    events: z.array(RelayEventSchema),
    cursor: z.string().min(1).optional(),
});
export type TypedRelayEventsResponse = z.infer<typeof RelayEventsResponseSchema>;

// ─── helpers ─────────────────────────────────────────────────────────────────

/**
 * Exhaustiveness helper for switch statements on `TypedRelayEvent['type']`.
 * Mirrors `assertNeverMessage` in ws-messages.ts.
 */
export function assertNeverRelayEvent(e: never): never {
    throw new Error(`Unhandled RelayEvent variant: ${JSON.stringify(e)}`);
}

/**
 * Safe parser that validates a single raw event against the schema. Returns
 * a result union so callers can log the validation error without crashing
 * the poll loop.
 */
export type ParseRelayEventResult =
    | { ok: true; event: TypedRelayEvent }
    | { ok: false; error: string };

export function parseRelayEvent(raw: unknown): ParseRelayEventResult {
    const res = RelayEventSchema.safeParse(raw);
    if (res.success) return { ok: true, event: res.data };
    return { ok: false, error: res.error.issues.map((i) => i.message).join('; ') };
}

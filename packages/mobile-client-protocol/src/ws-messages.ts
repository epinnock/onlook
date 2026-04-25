/**
 * WebSocket message schema — the wire contract between cf-expo-relay and the
 * Onlook Mobile Client over the relay's `/ws` upgrade.
 *
 * Discriminated on `type`. Five message kinds:
 *
 *   bundleUpdate    (relay → client) — editor saved, new bundle URL ready
 *   onlook:select   (client → relay) — device tap mapped to a source location
 *   onlook:tap      (client → relay) — raw tap coordinates before source mapping
 *   onlook:console  (client → relay) — forwarded console.log/warn/error
 *   onlook:network  (client → relay) — forwarded fetch/XHR
 *   onlook:error    (client → relay) — runtime exception or React error boundary
 *
 * The relay routes these between the phone session and the editor session without
 * interpreting the payloads (except `bundleUpdate` which the relay originates).
 *
 * Built by MCF5 of plans/onlook-mobile-client-task-queue.md.
 */
import { z } from 'zod';

// ─── relay → client ──────────────────────────────────────────────────────────

export const BundleUpdateMessageSchema = z.object({
    type: z.literal('bundleUpdate'),
    sessionId: z.string().min(1),
    bundleUrl: z.string().url(),
    /** Matches the envelope's onlookRuntimeVersion. Client rejects on mismatch. */
    onlookRuntimeVersion: z.string(),
    timestamp: z.number().int().nonnegative(),
});
export type BundleUpdateMessage = z.infer<typeof BundleUpdateMessageSchema>;

// ─── client → relay ──────────────────────────────────────────────────────────

export const SourceLocationSchema = z.object({
    fileName: z.string().min(1),
    lineNumber: z.number().int().positive(),
    columnNumber: z.number().int().nonnegative(),
});
export type SourceLocation = z.infer<typeof SourceLocationSchema>;

export const SelectMessageSchema = z.object({
    type: z.literal('onlook:select'),
    sessionId: z.string().min(1),
    reactTag: z.number().int(),
    source: SourceLocationSchema,
});
export type SelectMessage = z.infer<typeof SelectMessageSchema>;

export const TapMessageSchema = z.object({
    type: z.literal('onlook:tap'),
    sessionId: z.string().min(1),
    timestamp: z.number().int().nonnegative(),
    // `.finite()` rejects NaN + ±Infinity — screen coordinates must be
    // finite or the editor's tap-to-source hit-test would misbehave.
    x: z.number().finite(),
    y: z.number().finite(),
    /** Present when the inspector resolved a RN host component at the hit point. */
    reactTag: z.number().int().optional(),
});
export type TapMessage = z.infer<typeof TapMessageSchema>;

export const ConsoleLevelSchema = z.enum(['log', 'info', 'warn', 'error', 'debug']);
export type ConsoleLevel = z.infer<typeof ConsoleLevelSchema>;

export const ConsoleMessageSchema = z.object({
    type: z.literal('onlook:console'),
    sessionId: z.string().min(1),
    level: ConsoleLevelSchema,
    /** Serialised args. Objects pre-JSON-stringified on the device for wire stability. */
    args: z.array(z.string()),
    timestamp: z.number().int().nonnegative(),
});
export type ConsoleMessage = z.infer<typeof ConsoleMessageSchema>;

export const NetworkMessageSchema = z.object({
    type: z.literal('onlook:network'),
    sessionId: z.string().min(1),
    requestId: z.string().min(1),
    method: z.string().min(1),
    url: z.string().url(),
    status: z.number().int().optional(),
    // `.finite()` rejects Infinity — otherwise a phone timing glitch
    // could poison network-latency p95 aggregates on the dev panel
    // (MobileNetworkTab renders `Duration` as a column, same soak
    // concern as overlayAck.mountDurationMs).
    durationMs: z.number().finite().nonnegative().optional(),
    phase: z.enum(['start', 'end', 'error']),
    timestamp: z.number().int().nonnegative(),
});
export type NetworkMessage = z.infer<typeof NetworkMessageSchema>;

export const ErrorMessageSchema = z.object({
    type: z.literal('onlook:error'),
    sessionId: z.string().min(1),
    /** 'js' = uncaught JS exception. 'react' = error boundary. 'native' = Hermes / JSI. */
    kind: z.enum(['js', 'react', 'native']),
    message: z.string(),
    stack: z.string().optional(),
    source: SourceLocationSchema.optional(),
    timestamp: z.number().int().nonnegative(),
});
export type ErrorMessage = z.infer<typeof ErrorMessageSchema>;

// ─── union ───────────────────────────────────────────────────────────────────

export const WsMessageSchema = z.discriminatedUnion('type', [
    BundleUpdateMessageSchema,
    SelectMessageSchema,
    TapMessageSchema,
    ConsoleMessageSchema,
    NetworkMessageSchema,
    ErrorMessageSchema,
]);
export type WsMessage = z.infer<typeof WsMessageSchema>;

/**
 * Exhaustiveness helper — used by switch statements on `WsMessage['type']` to
 * get a compile-time error if a new message kind is added without handling it.
 */
export function assertNeverMessage(msg: never): never {
    throw new Error(`Unhandled WsMessage variant: ${JSON.stringify(msg)}`);
}

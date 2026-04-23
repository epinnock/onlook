/**
 * Overlay ABI v1 — shared schemas.
 *
 * Codifies the contract defined in `plans/adr/overlay-abi-v1.md` (ADR-0001). Every layer —
 * editor preflight/pushOverlay, cf-expo-relay WS fan-out, mobile-client OverlayDispatcher,
 * base-bundle-builder manifest, and the base bundle's OnlookRuntime — imports from this
 * module so contract drift becomes a typecheck error, not a runtime mystery.
 *
 * Version bumps require a new ADR and a new literal ABI version string; both editor and
 * mobile client must refuse traffic whose `abi` does not match their compile-time constant.
 */
import { z } from 'zod';

// ─── ABI version ─────────────────────────────────────────────────────────────

export const ABI_VERSION = 'v1' as const;
export type AbiVersion = typeof ABI_VERSION;

export const AbiVersionSchema = z.literal(ABI_VERSION);

// ─── Source location (reused from ws-messages.ts, re-declared to keep abi-v1 self-contained)

export const AbiSourceLocationSchema = z.object({
    fileName: z.string().min(1),
    lineNumber: z.number().int().positive(),
    columnNumber: z.number().int().nonnegative(),
});
export type AbiSourceLocation = z.infer<typeof AbiSourceLocationSchema>;

// ─── Asset manifest (ADR §"Asset manifest") ──────────────────────────────────

export const AssetDescriptorSchema = z.discriminatedUnion('kind', [
    z.object({
        kind: z.literal('image'),
        hash: z.string().min(1),
        mime: z.string().min(1),
        width: z.number().positive().optional(),
        height: z.number().positive().optional(),
        scale: z.number().positive().optional(),
        uri: z.string().min(1),
    }),
    z.object({
        kind: z.literal('font'),
        hash: z.string().min(1),
        mime: z.string().min(1),
        family: z.string().min(1),
        weight: z.number().int().positive().optional(),
        style: z.enum(['normal', 'italic']).optional(),
        uri: z.string().min(1),
    }),
    z.object({
        kind: z.literal('svg'),
        hash: z.string().min(1),
        mime: z.literal('image/svg+xml'),
        viewBox: z.string().optional(),
        uri: z.string().min(1),
    }),
    z.object({
        kind: z.literal('media'),
        hash: z.string().min(1),
        mime: z.string().min(1),
        uri: z.string().min(1),
    }),
    z.object({
        kind: z.literal('json'),
        hash: z.string().min(1),
        value: z.unknown(),
    }),
    z.object({
        kind: z.literal('text'),
        hash: z.string().min(1),
        value: z.string(),
    }),
    z.object({
        kind: z.literal('binary'),
        hash: z.string().min(1),
        mime: z.string().min(1),
        uri: z.string().min(1),
    }),
]);
export type AssetDescriptor = z.infer<typeof AssetDescriptorSchema>;

export const OverlayAssetManifestSchema = z.object({
    abi: AbiVersionSchema,
    assets: z.record(z.string().min(1), AssetDescriptorSchema),
});
export type OverlayAssetManifest = z.infer<typeof OverlayAssetManifestSchema>;

// ─── Runtime error (ADR §"Error surface") ────────────────────────────────────

export const OnlookRuntimeErrorKindSchema = z.enum([
    'unknown-specifier',
    'overlay-parse',
    'overlay-runtime',
    'overlay-react',
    'asset-missing',
    'asset-load-failed',
    'abi-mismatch',
    'unsupported-native',
]);
export type OnlookRuntimeErrorKind = z.infer<typeof OnlookRuntimeErrorKindSchema>;

export const OnlookRuntimeErrorSchema = z.object({
    kind: OnlookRuntimeErrorKindSchema,
    message: z.string().min(1),
    stack: z.string().optional(),
    source: AbiSourceLocationSchema.optional(),
    specifier: z.string().optional(),
    assetId: z.string().optional(),
});
export type OnlookRuntimeError = z.infer<typeof OnlookRuntimeErrorSchema>;

// ─── Runtime capabilities (ADR §"Wire protocol") ─────────────────────────────

export const RuntimeCapabilitiesSchema = z.object({
    abi: AbiVersionSchema,
    baseHash: z.string().min(1),
    rnVersion: z.string().min(1),
    expoSdk: z.string().min(1),
    platform: z.enum(['ios', 'android']),
    aliases: z.array(z.string().min(1)).readonly(),
});
export type RuntimeCapabilities = z.infer<typeof RuntimeCapabilitiesSchema>;

// ─── Base manifest (Phase 1 task #10) ────────────────────────────────────────

export const BaseManifestSchema = z.object({
    abi: AbiVersionSchema,
    /** sha256 of the Metro-built base bundle bytes. */
    bundleHash: z.string().min(1),
    /** sha256 of the alias-map sidecar JSON. */
    aliasHash: z.string().min(1),
    rnVersion: z.string().min(1),
    expoSdk: z.string().min(1),
    reactVersion: z.string().min(1),
    platform: z.enum(['ios', 'android']),
    bundleUrl: z.string().url(),
    aliasMapUrl: z.string().url().optional(),
    sourceMapUrl: z.string().url().optional(),
    /** Exhaustive list of bare specifiers the base bundle serves via OnlookRuntime.require. */
    aliases: z.array(z.string().min(1)).readonly(),
});
export type BaseManifest = z.infer<typeof BaseManifestSchema>;

// ─── Overlay envelope (ADR §"Overlay source format" + §"Wire protocol") ──────

export const OverlayMetaSchema = z.object({
    /** sha256 of the overlay source string — stable across editor sessions. */
    overlayHash: z.string().min(1),
    /** Module id of the entry module inside the overlay's module table. Always 0 in v1. */
    entryModule: z.literal(0),
    /** Wall-clock ms the editor's bundler took to produce this overlay. */
    buildDurationMs: z.number().int().nonnegative(),
    /** R2 URL for the overlay's v3 source map, if uploaded. */
    sourceMapUrl: z.string().url().optional(),
});
export type OverlayMeta = z.infer<typeof OverlayMetaSchema>;

// ─── WS messages (ADR §"Wire protocol") ──────────────────────────────────────

/** editor → relay → phone. */
export const OverlayUpdateMessageSchema = z.object({
    type: z.literal('overlayUpdate'),
    abi: AbiVersionSchema,
    sessionId: z.string().min(1),
    source: z.string().min(1),
    assets: OverlayAssetManifestSchema,
    meta: OverlayMetaSchema,
});
export type OverlayUpdateMessage = z.infer<typeof OverlayUpdateMessageSchema>;

/** Either side → relay → other side. Used for version negotiation. */
export const AbiHelloMessageSchema = z.object({
    type: z.literal('abiHello'),
    abi: AbiVersionSchema,
    sessionId: z.string().min(1),
    role: z.enum(['editor', 'phone']),
    runtime: RuntimeCapabilitiesSchema,
});
export type AbiHelloMessage = z.infer<typeof AbiHelloMessageSchema>;

/** phone → relay → editor: runtime error report. */
export const AbiRuntimeErrorMessageSchema = z.object({
    type: z.literal('onlook:error'),
    sessionId: z.string().min(1),
    error: OnlookRuntimeErrorSchema,
    timestamp: z.number().int().nonnegative(),
});
export type AbiRuntimeErrorMessage = z.infer<typeof AbiRuntimeErrorMessageSchema>;

/**
 * phone → relay → editor: explicit mount-acknowledgement.
 *
 * Sent by the mobile client's OnlookRuntime after `mountOverlay` resolves
 * (or the catch block that would fire on failure). Lets the editor's
 * `OverlayPipeline.markMounted(overlayHash)` fire from an explicit signal
 * instead of an absence-of-onlook:error heuristic.
 */
export const OverlayAckMessageSchema = z.object({
    type: z.literal('onlook:overlayAck'),
    sessionId: z.string().min(1),
    overlayHash: z.string().min(1),
    status: z.enum(['mounted', 'failed']),
    error: OnlookRuntimeErrorSchema.optional(),
    timestamp: z.number().int().nonnegative(),
    /**
     * Wall-clock milliseconds the phone spent between receiving the overlay
     * source on the WS channel and `mountOverlay` resolving. ADR-0001
     * §"Performance envelope" targets ≤100ms on a 2-year-old iPhone. Optional
     * because legacy phone binaries don't populate it; new binaries measure
     * with `performance.now()` around the mount call and send the delta.
     * Editor-side: surfaces in Phase 11b soak as the eval-latency signal.
     *
     * `.finite()` guards against a misbehaving phone clock sending `Infinity`
     * (which zod's `.number()` accepts by default). An `Infinity` value
     * would silently poison p95 aggregates in the soak dashboard — safer to
     * reject at the schema boundary so the editor marks the ack malformed
     * and drops it instead of persisting a nonsense duration.
     */
    mountDurationMs: z.number().finite().nonnegative().optional(),
});
export type OverlayAckMessage = z.infer<typeof OverlayAckMessageSchema>;

/**
 * The subset of WS messages added by ABI v1. The existing ws-messages.ts union continues
 * to own `onlook:select` / `onlook:tap` / `onlook:console` / `onlook:network` which are
 * unchanged. Once legacy `bundleUpdate` is retired (Phase 11 task #89), the two modules
 * will merge into a single discriminated union.
 */
export const AbiV1WsMessageSchema = z.discriminatedUnion('type', [
    OverlayUpdateMessageSchema,
    AbiHelloMessageSchema,
    AbiRuntimeErrorMessageSchema,
    OverlayAckMessageSchema,
]);
export type AbiV1WsMessage = z.infer<typeof AbiV1WsMessageSchema>;

// ─── Runtime global shape (ADR §"Runtime globals") ───────────────────────────

/**
 * The single global the base bundle installs. Both the JS fallback (Phase 2) and the
 * native host object (Phase 3) expose this exact shape. Declared as an interface rather
 * than a Zod schema because it contains function values — not wire-serializable.
 */
export interface OnlookRuntimeApi {
    readonly abi: AbiVersion;
    readonly impl: 'js' | 'native';
    readonly __native?: true;

    require(specifier: string): unknown;
    mountOverlay(
        source: string,
        props?: Readonly<Record<string, unknown>>,
        assets?: OverlayAssetManifest,
    ): void;
    unmount(): void;
    resolveAsset(assetId: string): AssetDescriptor;
    preloadAssets(assetIds: readonly string[]): Promise<void>;
    loadFont(
        fontFamily: string,
        assetRef: string,
        options?: { readonly weight?: number; readonly style?: 'normal' | 'italic' },
    ): Promise<void>;
    reportError(error: OnlookRuntimeError): void;

    readonly lastMount?: {
        readonly source: string;
        readonly props: Readonly<Record<string, unknown>>;
        readonly assets?: OverlayAssetManifest;
    };
}

// ─── Version negotiation helpers (task #5) ───────────────────────────────────

/**
 * Editor-side guard. Returns null if the editor may send `overlayUpdate` to this phone, or
 * an `OnlookRuntimeError` describing why not (for display in the editor status UI).
 */
export function checkAbiCompatibility(
    editorAbi: AbiVersion,
    phone: RuntimeCapabilities,
): OnlookRuntimeError | null {
    if (editorAbi !== phone.abi) {
        return {
            kind: 'abi-mismatch',
            message: `Editor ABI ${editorAbi} incompatible with phone ABI ${phone.abi}. Rebuild the base bundle and reinstall the mobile client.`,
        };
    }
    return null;
}

/**
 * Runtime-side guard. Called inside `mountOverlay` before the eval step. Throws an
 * OnlookRuntimeError on mismatch rather than attempting to execute overlay source that
 * was compiled against a different runtime shape.
 */
export function assertOverlayAbiCompatible(
    runtimeAbi: AbiVersion,
    overlayAbi: AbiVersion,
): void {
    if (runtimeAbi !== overlayAbi) {
        throw Object.assign(new Error(`overlay ABI ${overlayAbi} vs runtime ABI ${runtimeAbi}`), {
            __onlookError: {
                kind: 'abi-mismatch',
                message: `overlay ABI ${overlayAbi} incompatible with runtime ABI ${runtimeAbi}`,
            } satisfies OnlookRuntimeError,
        });
    }
}

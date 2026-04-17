/**
 * Relay manifest schema — the shape of the JSON response cf-expo-relay serves at
 * `GET /manifest/<sessionId>`. Mirrors the Expo Updates manifest contract with an
 * Onlook-specific `extra.expoClient.onlookRuntimeVersion` field that the mobile
 * client uses for compatibility validation.
 *
 * The schema is intentionally permissive about unknown fields (`passthrough`) so
 * upstream Expo Updates changes don't break the mobile client's parser — we only
 * validate what we read.
 *
 * Built by MCF4 of plans/onlook-mobile-client-task-queue.md.
 */
import { z } from 'zod';

export const ManifestAssetSchema = z.object({
    // `hash` is marked OPTIONAL per Expo Updates v2 spec — it's used for
    // integrity verification on production OTA builds, but local Metro
    // (via cf-expo-relay / `expo start`) doesn't compute it ahead of time
    // and omits the field entirely. Our mobile-client treats a present
    // hash as advisory; bundle integrity on a LAN session is already
    // bounded by the relay WS's sessionId scope.
    hash: z.string().min(1).optional(),
    key: z.string().min(1),
    contentType: z.string().min(1),
    url: z.string().url(),
    fileExtension: z.string().optional(),
});
export type ManifestAsset = z.infer<typeof ManifestAssetSchema>;

export const ExpoClientExtraSchema = z
    .object({
        /** Onlook-specific. Set by MC6.2's manifest-builder.ts patch. */
        onlookRuntimeVersion: z.string().optional(),
        /** Bumped whenever the relay ↔ client wire protocol changes incompatibly. */
        protocolVersion: z.number().int().nonnegative().optional(),
        /** The `expo.scheme` from app.config.ts — "onlook" for the mobile client. */
        scheme: z.string().optional(),
    })
    .passthrough();
export type ExpoClientExtra = z.infer<typeof ExpoClientExtraSchema>;

export const ManifestSchema = z.object({
    id: z.string().min(1),
    createdAt: z.string(), // ISO8601
    runtimeVersion: z.string().min(1),
    launchAsset: ManifestAssetSchema,
    assets: z.array(ManifestAssetSchema),
    metadata: z.record(z.string(), z.unknown()).optional(),
    extra: z
        .object({
            expoClient: ExpoClientExtraSchema,
        })
        .passthrough(),
});

export type Manifest = z.infer<typeof ManifestSchema>;

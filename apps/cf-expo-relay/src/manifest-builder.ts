/**
 * cf-expo-relay manifest builder.
 *
 * Pure transform from the per-build `manifest-fields.json` (TH0.3) plus the
 * runtime parameters (`bundleHash`, public `cf-esm-cache` URL) to a complete
 * Expo Updates v2 manifest as consumed by SDK 54 Expo Go (TQ0.2).
 *
 * The relay's only computed responsibilities are:
 *   - `id`           — set to the request's `bundleHash`
 *   - `createdAt`    — `builtAt` from `meta.json`, falling back to "now"
 *   - `launchAsset.url` and each `assets[].url` — rewritten against the
 *     environment's public `cf-esm-cache` host so the same builder output
 *     can be served from any environment without re-rendering
 *
 * Everything else is forwarded verbatim from `manifest-fields.json` so the
 * relay never disagrees with the builder about what a build "is".
 *
 * This module is intentionally self-contained (no I/O, no globals beyond an
 * optional `Date` call when `builtAt` is omitted) so it can be unit-tested
 * with frozen inputs and re-used by both the HTTP route (TQ1.2) and any
 * scenario harness that wants to assert manifest shape (TQ4.1 / scenario 10).
 */

/** The internal field set written by cf-esm-builder per TH0.3 (manifest-fields.json). */
export interface ManifestFields {
    runtimeVersion: string;
    launchAsset: {
        key: string;
        contentType: string;
    };
    assets: Array<{
        key: string;
        contentType: string;
        fileExtension: string;
    }>;
    metadata: Record<string, unknown>;
    extra: {
        expoClient: {
            name: string;
            slug: string;
            version: string;
            sdkVersion: string;
            platforms: string[];
            icon: string | null;
            splash: { backgroundColor: string };
            newArchEnabled: boolean;
        };
        scopeKey: string;
        eas: { projectId: string | null };
    };
}

/**
 * Platform string Expo Go sends in the `Expo-Platform` header on every
 * manifest fetch. Drives `launchAsset.url` selection between the android
 * and ios Hermes bundles produced by the Container.
 */
export type ExpoPlatform = 'ios' | 'android';

export interface BuildManifestInput {
    bundleHash: string;
    /** Public cf-esm-cache origin, e.g. 'https://cf-esm-cache.example.workers.dev'. */
    cfEsmCacheUrl: string;
    fields: ManifestFields;
    /** ISO timestamp; defaults to `new Date().toISOString()`. */
    builtAt?: string;
    /**
     * Target platform for `launchAsset.url`. Defaults to `'android'` so the
     * old single-platform call sites keep their existing behavior. New
     * call sites should pass the value derived from the `Expo-Platform`
     * request header.
     */
    platform?: ExpoPlatform;
}

export interface ExpoLaunchAsset {
    key: string;
    contentType: string;
    url: string;
}

export interface ExpoAsset {
    key: string;
    contentType: string;
    url: string;
    fileExtension: string;
}

export interface ExpoManifest {
    id: string;
    createdAt: string;
    runtimeVersion: string;
    launchAsset: ExpoLaunchAsset;
    assets: ExpoAsset[];
    metadata: Record<string, unknown>;
    extra: ManifestFields["extra"];
}

/**
 * Build a complete Expo Go (Expo Updates v2) manifest from the per-build
 * `manifest-fields.json` payload plus the per-environment public cache URL.
 *
 * Pure: no I/O, deterministic for any fixed input. The only non-determinism
 * source is the optional `Date.now()` fallback when `builtAt` is omitted —
 * callers that need a frozen `createdAt` must pass it explicitly.
 */
export function buildManifest(input: BuildManifestInput): ExpoManifest {
    const { bundleHash, fields } = input;
    const baseUrl = stripTrailingSlash(input.cfEsmCacheUrl);
    const createdAt = input.builtAt ?? new Date().toISOString();
    const platform: ExpoPlatform = input.platform ?? 'android';

    const launchAsset: ExpoLaunchAsset = {
        key: fields.launchAsset.key,
        contentType: fields.launchAsset.contentType,
        url: `${baseUrl}/bundle/${bundleHash}/index.${platform}.bundle`,
    };

    const assets: ExpoAsset[] = fields.assets.map((asset) => ({
        key: asset.key,
        contentType: asset.contentType,
        fileExtension: asset.fileExtension,
        url: `${baseUrl}/bundle/${bundleHash}/${asset.key}${asset.fileExtension}`,
    }));

    // Expo Updates v2 requires `id` to be a UUID v4 (per the spec at
    // https://docs.expo.dev/technical-specs/expo-updates-1/). Our content-
    // addressable bundleHash is a 64-char SHA256 hex string — derive a
    // deterministic v4-shaped UUID by slicing the first 32 hex chars and
    // re-formatting with the v4 variant + version bits in the right
    // positions. Same hash → same UUID, so the editor can still use the
    // bundleHash everywhere else for caching/equality checks.
    const id = bundleHashToUuidV4(bundleHash);

    return {
        id,
        createdAt,
        runtimeVersion: fields.runtimeVersion,
        launchAsset,
        assets,
        metadata: fields.metadata,
        extra: fields.extra,
    };
}

/**
 * Reformat a 64-char hex SHA256 hash as a deterministic UUID v4 string.
 * Sets the version nibble (13th hex digit) to 4 and the variant nibble
 * (17th) to one of [8,9,a,b], so the result is a syntactically valid v4
 * UUID even though it isn't randomly generated. Expo Go's manifest parser
 * only checks the syntax, not whether the UUID is "really" v4.
 */
export function bundleHashToUuidV4(bundleHash: string): string {
    if (bundleHash.length < 32) {
        // Defensive — never expected in practice (sha256 is 64 chars).
        return bundleHash;
    }
    const h = bundleHash.toLowerCase().slice(0, 32);
    // Force version 4 in the 13th hex char (1-indexed: position 13).
    // Force variant 10xx in the 17th hex char (one of 8,9,a,b).
    const v4 = h.slice(0, 12) + '4' + h.slice(13, 16) +
        // pick the variant nibble: take the original char at index 16 and
        // OR with 0x8 to force the high bit (10xx variant).
        (((parseInt(h[16] ?? '0', 16) & 0x3) | 0x8).toString(16)) +
        h.slice(17, 32);
    return `${v4.slice(0, 8)}-${v4.slice(8, 12)}-${v4.slice(12, 16)}-${v4.slice(16, 20)}-${v4.slice(20, 32)}`;
}

function stripTrailingSlash(url: string): string {
    return url.endsWith("/") ? url.slice(0, -1) : url;
}

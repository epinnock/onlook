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

export interface BuildManifestInput {
    bundleHash: string;
    /** Public cf-esm-cache origin, e.g. 'https://cf-esm-cache.example.workers.dev'. */
    cfEsmCacheUrl: string;
    fields: ManifestFields;
    /** ISO timestamp; defaults to `new Date().toISOString()`. */
    builtAt?: string;
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

    const launchAsset: ExpoLaunchAsset = {
        key: fields.launchAsset.key,
        contentType: fields.launchAsset.contentType,
        url: `${baseUrl}/bundle/${bundleHash}/index.android.bundle`,
    };

    const assets: ExpoAsset[] = fields.assets.map((asset) => ({
        key: asset.key,
        contentType: asset.contentType,
        fileExtension: asset.fileExtension,
        url: `${baseUrl}/bundle/${bundleHash}/${asset.key}${asset.fileExtension}`,
    }));

    return {
        id: bundleHash,
        createdAt,
        runtimeVersion: fields.runtimeVersion,
        launchAsset,
        assets,
        metadata: fields.metadata,
        extra: fields.extra,
    };
}

function stripTrailingSlash(url: string): string {
    return url.endsWith("/") ? url.slice(0, -1) : url;
}

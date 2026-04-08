/**
 * Editor-side mirror of the cf-expo-relay manifest types.
 *
 * IMPORTANT: These interfaces MUST stay in sync with the authoritative
 * definitions in `apps/cf-expo-relay/src/manifest-builder.ts`. They are
 * duplicated here (instead of re-exported) because the editor's TypeScript
 * program (`apps/web/client/tsconfig.json`) scopes `include` to its own
 * `src` tree and cannot cleanly cross into another workspace package that
 * is not published via a package entry point.
 *
 * If you change a field in `cf-expo-relay/src/manifest-builder.ts`, update
 * this file in the same PR.
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
    extra: ManifestFields['extra'];
}

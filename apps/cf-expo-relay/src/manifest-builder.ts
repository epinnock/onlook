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
 *   - `extra.expoClient.onlookRuntimeVersion` — stamped with the protocol
 *     package's `ONLOOK_RUNTIME_VERSION` (MC6.2) so the mobile client can
 *     check bundle/binary compatibility before mounting
 *
 * Everything else is forwarded verbatim from `manifest-fields.json` so the
 * relay never disagrees with the builder about what a build "is".
 *
 * This module is intentionally self-contained (no I/O, no globals beyond an
 * optional `Date` call when `builtAt` is omitted) so it can be unit-tested
 * with frozen inputs and re-used by both the HTTP route (TQ1.2) and any
 * scenario harness that wants to assert manifest shape (TQ4.1 / scenario 10).
 */

import { ONLOOK_RUNTIME_VERSION } from '@onlook/mobile-client-protocol';

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
        // Some fields are optional because the shape that arrives from
        // cf-esm-builder's container/build.sh contains MORE fields than
        // expo-cli's strict schema (icon: null, splash: {...},
        // runtimeVersion duplicated). buildManifest() strips them at
        // serve time before returning the response. Future cleanup:
        // remove them from build.sh too.
        expoClient: {
            name: string;
            slug: string;
            version: string;
            sdkVersion: string;
            platforms: string[];
            icon?: string | null;
            splash?: { backgroundColor: string };
            newArchEnabled: boolean;
            runtimeVersion?: string;
            orientation?: string;
            userInterfaceStyle?: string;
            ios?: Record<string, unknown>;
            android?: Record<string, unknown>;
            web?: Record<string, unknown>;
        };
        scopeKey: string;
        eas?: { projectId: string | null } | Record<string, never>;
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
    /**
     * Public host:port of the relay itself (e.g. `expo-relay.onlook.workers.dev`
     * in production or `192.168.0.14:8787` in local LAN dev). Used to fill in
     * `extra.expoClient.hostUri` and `extra.expoGo.debuggerHost` — Expo Go
     * SDK 50+ uses these for HMR socket / log streaming addresses, AND for
     * cross-validating that the manifest came from a real dev server.
     *
     * Optional ONLY for backward compat with the test fixtures. New call
     * sites SHOULD always pass it. When omitted, the patched fields use
     * the cfEsmCacheUrl host as a fallback (which is wrong for production
     * but harmless for unit tests that don't validate it).
     */
    relayHostUri?: string;
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

/**
 * The shape of `extra` that we EMIT (different from the input shape we
 * RECEIVE in ManifestFields). The output is patched at serve time to
 * match expo-cli's exact format — includes `_internal`, `expoGo`, the
 * formatted `scopeKey`, and an empty `eas` object.
 */
export interface ExpoManifestExtra {
    eas: Record<string, never>;
    expoClient: Record<string, unknown> & {
        name: string;
        slug: string;
        _internal: {
            isDebug: boolean;
            projectRoot: string;
            dynamicConfigPath: string | null;
            staticConfigPath: string;
            packageJsonPath: string;
        };
        hostUri: string;
        /**
         * Semver string sourced from `ONLOOK_RUNTIME_VERSION` in
         * `@onlook/mobile-client-protocol`. The mobile client reads this at
         * manifest-fetch time (MCF7/MC6.2) and refuses to mount when its own
         * binary version is incompatible per `isCompatible()`.
         */
        onlookRuntimeVersion: string;
    };
    expoGo: {
        debuggerHost: string;
        developer: { tool: string; projectRoot: string };
        packagerOpts: { dev: boolean };
        mainModuleName: string;
    };
    scopeKey: string;
}

export interface ExpoManifest {
    id: string;
    createdAt: string;
    runtimeVersion: string;
    launchAsset: ExpoLaunchAsset;
    assets: ExpoAsset[];
    metadata: Record<string, unknown>;
    extra: ExpoManifestExtra;
}

/**
 * Build a complete Expo Go (Expo Updates v2) manifest from the per-build
 * `manifest-fields.json` payload plus the per-environment public cache URL.
 *
 * Applies the byte-perfect patches verified against real `expo start` on
 * 2026-04-09: strip `icon`/`splash`/`runtimeVersion` from expoClient, add
 * `_internal` block, add `extra.expoGo` block (developer/packagerOpts/
 * mainModuleName/debuggerHost), reformat `scopeKey` to
 * `@anonymous/<slug>-<uuid>`, normalize `eas` to an empty object, normalize
 * `createdAt` to include milliseconds, and route `launchAsset.url` per
 * platform.
 *
 * Pure: no I/O, deterministic for any fixed input. The only non-determinism
 * source is the optional `Date.now()` fallback when `builtAt` is omitted —
 * callers that need a frozen `createdAt` must pass it explicitly.
 *
 * The body patches were necessary because iOS Expo Go SDK 54 strict-validates
 * the manifest fields and asserts on missing or unexpected ones. The fields
 * we strip (`icon: null`, `splash`, inner `runtimeVersion`) were observed
 * in our manifest but ABSENT from real expo-cli's response — Expo Go's
 * NSURLSession response handler asserts on their presence. The fields we
 * add (`_internal`, `extra.expoGo`) were observed in expo-cli's response
 * but absent from ours — Expo Go asserts on their absence.
 */
export function buildManifest(input: BuildManifestInput): ExpoManifest {
    const { bundleHash, fields } = input;
    const baseUrl = stripTrailingSlash(input.cfEsmCacheUrl);
    const createdAt = normalizeCreatedAt(input.builtAt ?? new Date().toISOString());
    const platform: ExpoPlatform = input.platform ?? 'android';
    const relayHostUri =
        input.relayHostUri ?? extractHost(baseUrl) ?? 'expo-relay.onlook.dev';

    // launchAsset.url uses Metro's URL convention so Expo Go's URL parser
    // sees a familiar shape. The hash is embedded in the entry filename
    // (`/<hash>.ts.bundle`) instead of as a query param so the URL stays
    // Metro-shaped from Expo Go's perspective.
    const bundleQuery = new URLSearchParams({
        platform,
        dev: 'false',
        hot: 'false',
        lazy: 'true',
        minify: 'true',
        'transform.engine': 'hermes',
        'transform.bytecode': '1',
        'transform.routerRoot': 'app',
        unstable_transformProfile: 'hermes-stable',
    });
    const launchAsset: ExpoLaunchAsset = {
        // launchAsset.key is the LITERAL string "bundle" — expo-cli sends
        // exactly that. We previously sent `bundle-<hash>` which Expo Go
        // accepted but didn't match expo-cli's wire format.
        key: 'bundle',
        contentType: fields.launchAsset.contentType,
        url: `https://${relayHostUri}/${bundleHash}.${platform === 'ios' ? 'ios' : 'android'}.bundle?${bundleQuery.toString()}`,
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

    // Strip fields expo-cli does NOT include in expoClient (Expo Go SDK 54
    // asserts on their presence). Allowlist: copy only the fields the
    // schema permits. Unknown fields fall through to the rest spread but
    // the three blacklisted ones are explicitly removed.
    const cleanedExpoClient: ManifestFields['extra']['expoClient'] = {
        ...fields.extra.expoClient,
    };
    delete (cleanedExpoClient as Record<string, unknown>).icon;
    delete (cleanedExpoClient as Record<string, unknown>).splash;
    delete (cleanedExpoClient as Record<string, unknown>).runtimeVersion;

    // The `extra` block is the part Expo Go SDK 54 strictly validates.
    // Build it from scratch to match expo-cli's exact shape.
    //
    // - `_internal` is REQUIRED (Expo Go's parser checks for it). The
    //   path values are cosmetic — Expo Go reads them but doesn't act on
    //   them. We use a stable-looking dummy.
    // - `expoGo` is REQUIRED (per expo-cli ManifestMiddleware source
    //   comment: "Required for Expo Go to function").
    // - `scopeKey` follows expo-cli's `@anonymous/<slug>-<uuid>` convention.
    // - `eas` is an EMPTY OBJECT (not `{ projectId: null }`) — strict
    //   parsers reject null projectId.
    const slug = cleanedExpoClient.slug;
    const anonymousId = bundleHashToUuidV4(bundleHash);
    const scopeKey = `@anonymous/${slug}-${anonymousId}`;

    return {
        id,
        createdAt,
        runtimeVersion: fields.runtimeVersion,
        launchAsset,
        assets,
        metadata: fields.metadata,
        extra: {
            eas: {},
            expoClient: {
                ...cleanedExpoClient,
                _internal: {
                    isDebug: false,
                    projectRoot: '/private/tmp/onlook-fixture',
                    dynamicConfigPath: null,
                    staticConfigPath: '/private/tmp/onlook-fixture/app.json',
                    packageJsonPath: '/private/tmp/onlook-fixture/package.json',
                },
                hostUri: relayHostUri,
                // MC6.2: stamp the binary/bundle compatibility version so the
                // Onlook mobile client can gate its mount on semver match
                // (see packages/mobile-client-protocol/src/runtime-version.ts).
                // Sourced from the protocol package directly — never hardcoded,
                // so a single bump in MCF7/MC6.1 propagates to every consumer.
                onlookRuntimeVersion: ONLOOK_RUNTIME_VERSION,
            } as ExpoManifest['extra']['expoClient'],
            expoGo: {
                debuggerHost: relayHostUri,
                developer: {
                    tool: 'expo-cli',
                    projectRoot: '/private/tmp/onlook-fixture',
                },
                packagerOpts: { dev: false },
                mainModuleName: 'index.ts',
            },
            scopeKey,
        } as ExpoManifest['extra'],
    };
}

/**
 * Normalize an ISO 8601 timestamp to ALWAYS include milliseconds, e.g.
 * `2026-04-09T01:48:53Z` → `2026-04-09T01:48:53.000Z`. Strict parsers
 * (including Expo Go SDK 54) reject the no-milliseconds form even though
 * it's valid ISO 8601. expo-cli always emits `.NNN`.
 */
function normalizeCreatedAt(value: string): string {
    if (typeof value !== 'string') return value;
    if (value.endsWith('Z') && !value.includes('.')) {
        return `${value.slice(0, -1)}.000Z`;
    }
    return value;
}

/**
 * Extract the `host[:port]` portion from a URL. Used as a fallback when
 * the relay's public host wasn't passed explicitly to buildManifest.
 */
function extractHost(url: string): string | undefined {
    try {
        const parsed = new URL(url);
        return parsed.host;
    } catch {
        return undefined;
    }
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

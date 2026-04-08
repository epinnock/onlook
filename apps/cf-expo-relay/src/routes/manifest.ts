/**
 * cf-expo-relay `GET /manifest/:bundleHash` route (TQ1.2).
 *
 * Reads the per-build artifacts written by `cf-esm-builder` (TH0.3 / TH1.2)
 * from `cf-esm-cache` and folds them into a complete Expo Updates v2 manifest
 * via `buildManifest` (TQ1.1).
 *
 * The cache origin is reached via a Worker service binding (`ESM_CACHE`) when
 * available so cross-Worker calls stay on Cloudflare's internal RPC fabric;
 * otherwise the route falls back to a plain `fetch()` against `ESM_CACHE_URL`,
 * which is what local `wrangler dev` and the unit tests rely on.
 *
 * Headers are fixed to the TQ0.2 wire contract:
 *   - `Content-Type: application/json`
 *   - `Cache-Control: no-cache, no-store`
 *   - `expo-protocol-version: 1`
 *   - `expo-sfv-version: 0`
 *
 * This route deliberately does NOT touch `worker.ts` — TQ1.4 wires it in.
 */
import { buildManifest, type ExpoManifest, type ManifestFields } from '../manifest-builder';

/** Minimal shape of a Worker service binding (ESM_CACHE) for typing only. */
export interface ServiceBinding {
    fetch: (request: Request) => Promise<Response>;
}

export interface ManifestRouteEnv {
    /** Service binding to cf-esm-cache (or fallback to direct HTTP fetch when absent). */
    ESM_CACHE?: ServiceBinding;
    /** Public URL of cf-esm-cache for building manifest URLs (no trailing slash required). */
    ESM_CACHE_URL: string;
}

/** Shape of `meta.json` we care about; the rest is ignored on purpose. */
interface MetaJson {
    builtAt?: string;
}

const HEX64 = /^[0-9a-f]{64}$/;

const EXPO_HEADERS: Record<string, string> = {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-cache, no-store',
    'expo-protocol-version': '1',
    'expo-sfv-version': '0',
};

/**
 * Handle `GET /manifest/:bundleHash`.
 *
 * Validates the hash, fetches `manifest-fields.json` and `meta.json` from
 * `cf-esm-cache` (preferring the service binding when present), then returns
 * the Expo manifest with the required headers.
 */
export async function handleManifest(
    request: Request,
    env: ManifestRouteEnv,
    bundleHash: string,
): Promise<Response> {
    if (!HEX64.test(bundleHash)) {
        return new Response('expo-relay: invalid bundleHash', { status: 400 });
    }

    const baseUrl = stripTrailingSlash(env.ESM_CACHE_URL);
    const fieldsUrl = `${baseUrl}/bundle/${bundleHash}/manifest-fields.json`;
    const metaUrl = `${baseUrl}/bundle/${bundleHash}/meta.json`;

    const fieldsResponse = await fetchFromCache(env, fieldsUrl);
    if (fieldsResponse.status === 404) {
        return new Response('expo-relay: bundle not found', { status: 404 });
    }
    if (!fieldsResponse.ok) {
        return new Response('expo-relay: cache error fetching manifest-fields.json', {
            status: 502,
        });
    }

    let fields: ManifestFields;
    try {
        fields = (await fieldsResponse.json()) as ManifestFields;
    } catch {
        return new Response('expo-relay: invalid manifest-fields.json', { status: 502 });
    }

    // meta.json is best-effort: if it's absent or malformed we still serve a
    // manifest using "now" so the runtime path is robust against in-progress
    // writers (TH1.2 writes meta.json LAST, so a missing meta is "still building").
    let builtAt: string | undefined;
    const metaResponse = await fetchFromCache(env, metaUrl);
    if (metaResponse.ok) {
        try {
            const meta = (await metaResponse.json()) as MetaJson;
            if (typeof meta.builtAt === 'string') {
                builtAt = meta.builtAt;
            }
        } catch {
            // fall through to default
        }
    }

    const manifest: ExpoManifest = buildManifest({
        bundleHash,
        cfEsmCacheUrl: env.ESM_CACHE_URL,
        fields,
        builtAt: builtAt ?? new Date().toISOString(),
    });

    return new Response(JSON.stringify(manifest), {
        status: 200,
        headers: EXPO_HEADERS,
    });
}

async function fetchFromCache(env: ManifestRouteEnv, url: string): Promise<Response> {
    const req = new Request(url, { method: 'GET' });
    if (env.ESM_CACHE) {
        return env.ESM_CACHE.fetch(req);
    }
    return fetch(req);
}

function stripTrailingSlash(url: string): string {
    return url.endsWith('/') ? url.slice(0, -1) : url;
}

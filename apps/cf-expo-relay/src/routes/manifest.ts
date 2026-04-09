/**
 * cf-expo-relay `GET /manifest/:bundleHash` route.
 *
 * Reads the per-build artifacts written by `cf-esm-builder` (TH0.3 / TH1.2)
 * from `cf-esm-cache` and folds them into a complete Expo Updates v2 manifest
 * via `buildManifest`.
 *
 * The cache origin is reached via a Worker service binding (`ESM_CACHE`) when
 * available so cross-Worker calls stay on Cloudflare's internal RPC fabric;
 * otherwise the route falls back to a plain `fetch()` against `ESM_CACHE_URL`,
 * which is what local `wrangler dev` and the unit tests rely on.
 *
 * Response shape (verified byte-for-byte against real `expo start` on
 * 2026-04-09 — see plans/expo-browser-status.md for the bisection notes):
 *   - Status: 200
 *   - `content-type: multipart/mixed; boundary=formdata-<16hex>`
 *   - `cache-control: private, max-age=0`
 *   - `expo-protocol-version: 0`
 *   - `expo-sfv-version: 0`
 *   - Body: a multipart/mixed envelope with one `manifest` part containing
 *     the JSON-serialized ExpoManifest (Content-Disposition: form-data;
 *     name="manifest", Content-Type: application/json).
 *
 * Why multipart instead of plain JSON: Expo Go SDK 50+ from the App Store
 * sends `Accept: multipart/mixed,application/expo+json,application/json`
 * and uses the multipart code path for the dev-server signature bypass.
 * Plain JSON routes through the production validation path which requires
 * a real signature. Multipart bypasses the signature requirement when
 * the manifest body has the dev-server fields (extra.expoGo.developer).
 *
 * Cloudflare Workers serve responses over HTTP/2 to clients, which
 * mandates lowercase header names per RFC 7540 §8.1.2. Even though our
 * Headers object uses canonical PascalCase names, the wire format will
 * be lowercase by the time it reaches Expo Go.
 */
import {
    buildManifest,
    type ExpoManifest,
    type ExpoPlatform,
    type ManifestFields,
} from '../manifest-builder';

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

/**
 * Resolve the target platform for the manifest's `launchAsset.url` from
 * the request. Order of precedence:
 *   1. `Expo-Platform` request header (canonical — Expo Go SDK 50+ sends it)
 *   2. `?platform=` query string (curl-friendly fallback for testing)
 *   3. Default `'android'` (preserves the pre-iOS behavior of every existing
 *      caller, including scenario 10 and the local-relay-shim happy path)
 *
 * Anything other than `'ios'` or `'android'` is normalized to `'android'`
 * rather than 400'd, because Expo's protocol allows non-target platforms
 * (e.g. `'web'`) to receive a manifest the runtime then ignores. Returning
 * the android URL in those cases is harmless and cheaper than failing.
 */
export function resolvePlatform(request: Request): ExpoPlatform {
    const header = request.headers.get('expo-platform');
    if (header === 'ios') return 'ios';
    if (header === 'android') return 'android';

    try {
        const url = new URL(request.url);
        const query = url.searchParams.get('platform');
        if (query === 'ios') return 'ios';
        if (query === 'android') return 'android';
    } catch {
        // Bad URL — fall through to the default.
    }

    return 'android';
}

/**
 * Handle `GET /manifest/:bundleHash`.
 *
 * Validates the hash, fetches `manifest-fields.json` and `meta.json` from
 * `cf-esm-cache` (preferring the service binding when present), then returns
 * the Expo manifest with the required headers. The `launchAsset.url` is
 * routed to the platform-specific Hermes bundle based on the request's
 * `Expo-Platform` header.
 */
export async function handleManifest(
    request: Request,
    env: ManifestRouteEnv,
    bundleHash: string,
): Promise<Response> {
    if (!HEX64.test(bundleHash)) {
        return new Response('expo-relay: invalid bundleHash', { status: 400 });
    }

    const platform = resolvePlatform(request);
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

    // Compute the relay's public host:port from the incoming request URL
    // so the manifest's `extra.expoClient.hostUri` and
    // `extra.expoGo.debuggerHost` reflect the host the phone is talking
    // to. The phone uses these for HMR socket / log streaming endpoints.
    let relayHostUri: string | undefined;
    try {
        relayHostUri = new URL(request.url).host;
    } catch {
        // request.url should always parse, but be defensive.
        relayHostUri = undefined;
    }

    const manifest: ExpoManifest = buildManifest({
        bundleHash,
        cfEsmCacheUrl: env.ESM_CACHE_URL,
        fields,
        builtAt: builtAt ?? new Date().toISOString(),
        platform,
        relayHostUri,
    });

    // Wrap the manifest in a multipart/mixed envelope. The boundary is
    // derived from the bundle hash so it's deterministic per response.
    // Per-part headers MUST include both Content-Disposition and
    // Content-Type — expo-cli sets both, and Expo Go's parser may
    // assert if either is missing.
    const boundary = `formdata-${bundleHash.slice(0, 16)}`;
    const manifestJson = JSON.stringify(manifest);
    const body =
        `--${boundary}\r\n` +
        `Content-Disposition: form-data; name="manifest"\r\n` +
        `Content-Type: application/json\r\n` +
        `\r\n` +
        `${manifestJson}\r\n` +
        `--${boundary}--\r\n`;

    return new Response(body, {
        status: 200,
        headers: {
            'Content-Type': `multipart/mixed; boundary=${boundary}`,
            'Cache-Control': 'private, max-age=0',
            'expo-protocol-version': '0',
            'expo-sfv-version': '0',
        },
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

/**
 * cf-expo-relay `GET /<bundleHash>.<platform>.bundle` route handler.
 *
 * The manifest's `launchAsset.url` points back at the relay's own origin at
 * `/<64hex>.<ios|android>.bundle` (see manifest-builder's launchAsset URL
 * construction). This handler proxies that request through to cf-esm-cache
 * at `/bundle/<hash>/index.<platform>.bundle`, preferring the `ESM_CACHE`
 * Worker service binding when present and falling back to a direct `fetch`
 * against `ESM_CACHE_URL` for local `wrangler dev`.
 *
 * Hermes bytecode is immutable per hash so the response headers mark the
 * bundle as long-lived and immutable:
 *   - `Cache-Control: public, max-age=31536000, immutable`
 *   - `ETag: "<hash>"` (the hash itself; content-addressable and stable)
 *   - `Content-Type: application/javascript`
 *
 * Extracted from `worker.ts`'s inline fetch handler so it can be unit
 * tested independent of the rest of the router.
 */

/** Service-binding shape; duplicated rather than imported to keep this
 * module self-contained for testing. Matches the `ServiceBinding` in env.ts. */
interface UserBundleServiceBinding {
    fetch: (request: Request) => Promise<Response>;
}

export interface UserBundleRouteEnv {
    ESM_CACHE_URL: string;
    ESM_CACHE?: UserBundleServiceBinding;
}

/**
 * Regex for the user-bundle route. 64 lowercase hex for the hash, then
 * `.ios.bundle` or `.android.bundle`. Anchored so no query/fragment
 * leak into the captured groups.
 */
export const USER_BUNDLE_ROUTE = /^\/([0-9a-f]{64})\.(ios|android)\.bundle$/;

/** Parse the route shape; returns `null` for any non-matching pathname. */
export function parseUserBundleRoute(
    pathname: string,
): { hash: string; platform: 'ios' | 'android' } | null {
    const match = pathname.match(USER_BUNDLE_ROUTE);
    if (!match) return null;
    const [, hash, platform] = match;
    if (!hash || (platform !== 'ios' && platform !== 'android')) return null;
    return { hash, platform };
}

function stripTrailingSlash(url: string): string {
    return url.replace(/\/+$/, '');
}

/**
 * Proxy a user-bundle request through to cf-esm-cache and re-emit with
 * immutable-cache headers. The caller is responsible for matching the
 * route and only calling this on GET.
 */
export async function handleUserBundle(
    request: Request,
    env: UserBundleRouteEnv,
): Promise<Response> {
    const url = new URL(request.url);
    const parsed = parseUserBundleRoute(url.pathname);
    if (!parsed) {
        return new Response('expo-relay: not a user-bundle route', { status: 404 });
    }

    const upstream = `${stripTrailingSlash(env.ESM_CACHE_URL)}/bundle/${parsed.hash}/index.${parsed.platform}.bundle`;
    const upstreamRequest = new Request(upstream, { method: 'GET' });
    const resp = env.ESM_CACHE
        ? await env.ESM_CACHE.fetch(upstreamRequest)
        : await fetch(upstreamRequest);

    if (!resp.ok) {
        // Mirror the upstream status so 404s stay 404s and 5xxs surface
        // — callers (sim / device) get a real signal rather than a
        // confused 200-with-wrong-body.
        return new Response(`expo-relay: bundle ${resp.status}`, {
            status: resp.status,
        });
    }

    return new Response(resp.body, {
        status: 200,
        headers: {
            'Content-Type': 'application/javascript',
            'Cache-Control': 'public, max-age=31536000, immutable',
            ETag: `"${parsed.hash}"`,
        },
    });
}

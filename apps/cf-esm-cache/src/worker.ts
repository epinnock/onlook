/**
 * cf-esm-cache Worker.
 *
 * Sits in front of the `cf-esm-builder` Worker and provides an R2-backed
 * cache for built ESM bundles.
 *
 * Flow for `GET /pkg/<package>`:
 *   1. Compute a cache key from the request URL.
 *   2. Look up the bundle in R2 (`PACKAGES` binding).
 *      - HIT  -> return the cached body with `X-Cache: HIT`.
 *   3. On miss, forward the request to the `ESM_BUILDER` service binding.
 *      - If upstream is not OK, pass the response through unchanged
 *        (errors are NOT cached).
 *      - If upstream is OK, persist the body to R2 and return it with
 *        `X-Cache: MISS`.
 *
 * Any request not under `/pkg/` returns 404.
 */

export interface Env {
    PACKAGES: R2Bucket;
    ESM_BUILDER: Fetcher;
}

const CACHED_HEADERS: HeadersInit = {
    'Content-Type': 'application/javascript',
    'Cache-Control': 'public, max-age=31536000, immutable',
    'Access-Control-Allow-Origin': '*',
};

function buildCacheKey(url: URL): string {
    return `esm${url.pathname}${url.search}`;
}

export default {
    async fetch(request: Request, env: Env, _ctx: ExecutionContext): Promise<Response> {
        const url = new URL(request.url);

        if (!url.pathname.startsWith('/pkg/')) {
            return new Response('esm-cache: unknown route', { status: 404 });
        }

        const cacheKey = buildCacheKey(url);

        const cached = await env.PACKAGES.get(cacheKey);
        if (cached) {
            return new Response(cached.body, {
                headers: {
                    ...CACHED_HEADERS,
                    'X-Cache': 'HIT',
                },
            });
        }

        const upstream = await env.ESM_BUILDER.fetch(request);
        if (!upstream.ok) {
            // Do NOT cache errors - pass the upstream response through.
            return upstream;
        }

        const body = await upstream.arrayBuffer();
        await env.PACKAGES.put(cacheKey, body, {
            httpMetadata: { contentType: 'application/javascript' },
        });

        return new Response(body, {
            headers: {
                ...CACHED_HEADERS,
                'X-Cache': 'MISS',
            },
        });
    },
} satisfies ExportedHandler<Env>;

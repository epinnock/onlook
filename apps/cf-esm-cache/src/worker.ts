/**
 * cf-esm-cache Worker.
 *
 * Stale-while-revalidate proxy in front of `cf-esm-builder`'s
 * `GET /bundle/:hash[/<file>]` route. Implements TH3.1 / TH3.2 / TH3.3 of
 * `plans/expo-browser-e2e-task-queue.md`.
 *
 * Cache layout (R2 `expo-bundles` bucket — shared with cf-esm-builder, see
 * `plans/expo-browser-bundle-artifact.md` §R2 layout):
 *
 *     bundle/<hash>/index.android.bundle    ← Hermes bytecode (android target)
 *     bundle/<hash>/index.ios.bundle        ← Hermes bytecode (ios target)
 *     bundle/<hash>/assetmap.json
 *     bundle/<hash>/sourcemap.json
 *     bundle/<hash>/manifest-fields.json
 *     bundle/<hash>/meta.json
 *
 * The proxy is platform-agnostic: the filename in `/bundle/<hash>/<file>`
 * is forwarded to the builder verbatim, so `index.android.bundle` and
 * `index.ios.bundle` are cached and served independently. The default
 * (`/bundle/<hash>` with no filename) is `index.android.bundle` for
 * backward compatibility.
 *
 * Routes:
 *
 *   - `GET /health`                       → liveness probe
 *   - `GET|HEAD /bundle/<hash>[/<file>]`  → R2 cache HIT or BUILDER fallthrough
 *   - `POST /invalidate`                  → drop one hash from R2 (see
 *                                            `routes/invalidate.ts`)
 *   - everything else                     → 404
 *
 * On a cache MISS we tee the upstream body so the response can stream while
 * R2 is written in the background. We never cache non-2xx responses.
 */
import { handleInvalidate } from './routes/invalidate';

export interface Env {
    BUNDLES: R2Bucket;
    BUILDER: Fetcher;
}

const IMMUTABLE_CACHE_CONTROL = 'public, max-age=31536000, immutable';

export default {
    async fetch(request: Request, env: Env): Promise<Response> {
        const url = new URL(request.url);
        const path = url.pathname;
        const method = request.method;

        if (path === '/health') {
            return Response.json({ ok: true, version: '0.1.0' });
        }

        if (path === '/invalidate' && method === 'POST') {
            return handleInvalidate(request, env);
        }

        if (path.startsWith('/bundle/') && (method === 'GET' || method === 'HEAD')) {
            return handleBundleProxy(request, env);
        }

        return new Response('not found', { status: 404 });
    },
} satisfies ExportedHandler<Env>;

async function handleBundleProxy(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    // /bundle/<hash>            → ['<hash>']
    // /bundle/<hash>/<file>     → ['<hash>', '<file>']
    const parts = url.pathname.slice('/bundle/'.length).split('/').filter(Boolean);
    const hash = parts[0];
    const filename = parts[1] ?? 'index.android.bundle';
    if (!hash) {
        return new Response('missing hash', { status: 400 });
    }

    const r2Key = `bundle/${hash}/${filename}`;

    // 1. Cache lookup.
    const cached = await env.BUNDLES.get(r2Key);
    if (cached) {
        return new Response(cached.body, {
            headers: {
                'Content-Type': contentTypeFor(filename),
                'Cache-Control': IMMUTABLE_CACHE_CONTROL,
                ETag: `"${hash}"`,
                'X-Cache': 'HIT',
            },
        });
    }

    // 2. Cache miss → forward to the BUILDER service binding.
    const upstream = await env.BUILDER.fetch(
        new Request(`https://cf-esm-builder/bundle/${hash}/${filename}`, {
            method: request.method,
        }),
    );
    if (!upstream.ok) {
        return new Response(`upstream ${upstream.status}`, { status: upstream.status });
    }
    if (!upstream.body) {
        return new Response('upstream returned empty body', { status: 502 });
    }

    // Tee so we can stream the response and write R2 in the background.
    const [forResponse, forCache] = upstream.body.tee();
    // Fire-and-forget write — never blocks the response. Write failures only
    // cost us a future cache hit; the next request will repopulate.
    env.BUNDLES.put(r2Key, forCache, {
        httpMetadata: { contentType: contentTypeFor(filename) },
    }).catch((err: unknown) => {
        console.error('[cf-esm-cache] R2 put failed', r2Key, err);
    });

    return new Response(forResponse, {
        headers: {
            'Content-Type': contentTypeFor(filename),
            'Cache-Control': IMMUTABLE_CACHE_CONTROL,
            ETag: `"${hash}"`,
            'X-Cache': 'MISS',
        },
    });
}

function contentTypeFor(filename: string): string {
    if (filename.endsWith('.bundle')) return 'application/javascript';
    if (filename.endsWith('.json')) return 'application/json';
    return 'application/octet-stream';
}

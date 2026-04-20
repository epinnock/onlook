/**
 * cf-expo-relay base-bundle route.
 *
 * Serves immutable JS artifacts from the BASE_BUNDLES R2 bucket.
 */
import { assertBaseBundlesEnv, type BaseBundleRouteEnv } from '../env';

const BASE_BUNDLE_ROUTE_PREFIXES = new Set(['base-bundle', 'base-bundles']);
const CONTENT_HASH = /^[0-9a-f]{64}$/;
const IMMUTABLE_CACHE_CONTROL = 'public, max-age=31536000, immutable';

interface ParsedBaseBundleRoute {
    readonly bundleKey: string;
    readonly routePrefix: string;
    readonly validKey: boolean;
}

interface BaseBundleObject {
    body: ReadableStream<Uint8Array> | null;
}

function parseBaseBundleRoute(request: Request): ParsedBaseBundleRoute | null {
    const url = new URL(request.url);
    const parts = url.pathname.split('/').filter((part) => part.length > 0);

    if (parts.length !== 2 || !BASE_BUNDLE_ROUTE_PREFIXES.has(parts[0] ?? '')) {
        return null;
    }

    const bundleKey = parts[1];
    if (!bundleKey || !CONTENT_HASH.test(bundleKey)) {
        return {
            routePrefix: parts[0],
            bundleKey,
            validKey: false,
        };
    }

    return {
        routePrefix: parts[0],
        bundleKey,
        validKey: true,
    };
}

function makeImmutableHeaders(bundleKey: string): Headers {
    return new Headers({
        'Content-Type': 'application/javascript',
        'Cache-Control': IMMUTABLE_CACHE_CONTROL,
        ETag: `"${bundleKey}"`,
    });
}

export async function handleBaseBundle(
    request: Request,
    env: BaseBundleRouteEnv,
): Promise<Response> {
    const parsed = parseBaseBundleRoute(request);
    if (!parsed) {
        return new Response('expo-relay: unknown route', { status: 404 });
    }

    if (!parsed.validKey) {
        return new Response('expo-relay: invalid bundle key', { status: 400 });
    }

    assertBaseBundlesEnv(env, `/${parsed.routePrefix}`);

    if (request.method !== 'GET' && request.method !== 'HEAD') {
        return new Response('Method Not Allowed', {
            status: 405,
            headers: { Allow: 'GET, HEAD' },
        });
    }

    const object = (await env.BASE_BUNDLES.get(parsed.bundleKey)) as
        | BaseBundleObject
        | null;
    if (!object) {
        return new Response('expo-relay: base bundle not found', { status: 404 });
    }

    const headers = makeImmutableHeaders(parsed.bundleKey);
    if (request.method === 'HEAD') {
        return new Response(null, { status: 200, headers });
    }

    return new Response(object.body, {
        status: 200,
        headers,
    });
}

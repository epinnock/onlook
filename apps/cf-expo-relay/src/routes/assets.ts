import { assertBaseBundlesEnv, type Env } from '../env';

const BASE_BUNDLE_ROUTE_PREFIXES = ['/base-bundle', '/base-bundles'] as const;
const IMMUTABLE_CACHE_CONTROL = 'public, max-age=31536000, immutable';
const INVALID_ASSET_KEY_BODY = 'expo-relay: invalid base-bundle asset key';
const NOT_FOUND_BODY = 'expo-relay: asset not found';

export interface BaseBundleAssetsRouteParams {
    readonly assetKey: string;
}

export function parseBaseBundleAssetsRoute(
    request: Request,
): BaseBundleAssetsRouteParams | null {
    const pathname = new URL(request.url).pathname;

    for (const prefix of BASE_BUNDLE_ROUTE_PREFIXES) {
        const assetKey = parseAssetKeyFromPath(pathname, prefix);
        if (assetKey) {
            return { assetKey };
        }
    }

    return null;
}

export async function handleBaseBundleAssetsRoute(
    request: Request,
    env: Env,
): Promise<Response> {
    // Task #65 — HEAD support so the editor can ask "do you already have this
    // asset?" before re-uploading. Returns the same status codes as GET (200
    // hit / 404 miss / 400 invalid) with no body.
    if (request.method !== 'GET' && request.method !== 'HEAD') {
        return new Response('expo-relay: method not allowed', {
            status: 405,
            headers: { Allow: 'GET, HEAD' },
        });
    }

    assertBaseBundlesEnv(env, '/base-bundle/assets');

    const route = parseBaseBundleAssetsRoute(request);
    if (!route) {
        return new Response(INVALID_ASSET_KEY_BODY, {
            status: 400,
            headers: { 'Cache-Control': 'no-store' },
        });
    }

    if (request.method === 'HEAD') {
        return handleHead(env, route.assetKey);
    }

    const asset = await env.BASE_BUNDLES.get(route.assetKey);
    if (!asset) {
        return new Response(NOT_FOUND_BODY, {
            status: 404,
            headers: { 'Cache-Control': 'no-store' },
        });
    }

    const headers = new Headers();
    const typedAsset = asset as BaseBundleAssetBody;
    typedAsset.writeHttpMetadata?.(headers);
    headers.set('Cache-Control', IMMUTABLE_CACHE_CONTROL);

    if (!headers.has('Content-Type')) {
        headers.set('Content-Type', 'application/octet-stream');
    }

    return new Response(typedAsset.body, {
        status: 200,
        headers,
    });
}

async function handleHead(env: Env, assetKey: string): Promise<Response> {
    // Prefer .head() (cheaper — no body fetch) when the binding supports it.
    // Fall back to .get() so older bindings/test mocks still resolve.
    const bucket = env.BASE_BUNDLES as R2Bucket & {
        head?: (key: string) => Promise<R2Object | null>;
    };

    const meta = bucket.head
        ? await bucket.head(assetKey)
        : await bucket.get(assetKey);

    if (!meta) {
        return new Response(null, {
            status: 404,
            headers: { 'Cache-Control': 'no-store' },
        });
    }

    const headers = new Headers();
    const typedMeta = meta as BaseBundleAssetBody;
    typedMeta.writeHttpMetadata?.(headers);
    headers.set('Cache-Control', IMMUTABLE_CACHE_CONTROL);
    if (!headers.has('Content-Type')) {
        headers.set('Content-Type', 'application/octet-stream');
    }
    return new Response(null, { status: 200, headers });
}

type BaseBundleAssetBody = R2ObjectBody & {
    readonly body: BodyInit;
    readonly writeHttpMetadata?: (headers: Headers) => void;
};

function parseAssetKeyFromPath(pathname: string, prefix: string): string | null {
    if (pathname !== prefix && !pathname.startsWith(`${prefix}/`)) {
        return null;
    }

    const assetPath = pathname.slice(prefix.length + 1);
    if (!assetPath.startsWith('assets/')) {
        return null;
    }

    const decoded = safeDecodeURIComponent(assetPath);
    if (!decoded || !isValidAssetKey(decoded)) {
        return null;
    }

    return decoded;
}

function safeDecodeURIComponent(value: string): string | null {
    try {
        return decodeURIComponent(value);
    } catch {
        return null;
    }
}

function isValidAssetKey(assetKey: string): boolean {
    if (assetKey.length === 0) {
        return false;
    }

    const segments = assetKey.split('/');
    if (segments.some((segment) => segment.length === 0 || segment === '.' || segment === '..')) {
        return false;
    }

    return true;
}

/**
 * cf-expo-relay Worker.
 *
 * Relays JS bundles between an editor browser tab (which uploads bundles via
 * a WebSocket) and Expo Go on a user's phone (which fetches the manifest /
 * bundle over HTTP).
 *
 * Routes:
 *   GET  /manifest/:bundleHash   -> handleManifest (TQ1.2, 64-hex only)
 *   ANY  /base-bundle[/...]      -> 501 stub (Q0-23, route family reserved)
 *   ANY  /base-bundles[/...]     -> 501 stub (Q0-23, route family reserved)
 *   WS   /hmr/:sessionId         -> upgraded + forwarded to HmrSession DO (two-tier overlay channel)
 *   POST /push/:sessionId        -> forwarded to HmrSession DO as POST /push
 *   GET  /session/:id/manifest   -> forwarded to ExpoSession DO (legacy)
 *   GET  /session/:id/bundle.js  -> forwarded to ExpoSession DO (legacy)
 *   WS   /session/:id            -> upgraded + forwarded to ExpoSession DO
 *   *                            -> 404 "expo-relay: unknown route"
 *
 * Each session id maps to a Durable Object instance via
 * `EXPO_SESSION.idFromName(sessionId)` or `HMR_SESSION.idFromName(sessionId)`.
 */
import { handleManifest } from './routes/manifest';
import { handleBaseBundle } from './routes/base-bundle';
import {
    handleBaseBundleAssetsRoute,
    parseBaseBundleAssetsRoute,
} from './routes/assets';
import type { Env } from './env';
import { ExpoSession } from './session';
export { HmrSession } from './do/hmr-session';

export { ExpoSession };
export type { Env } from './env';

interface ParsedSessionRoute {
    sessionId: string;
    /** The remainder of the path forwarded to the DO, always starting with `/`. */
    subPath: string;
}

/**
 * Regex for the TQ1.2 `/manifest/:bundleHash` route. Anchored and restricted
 * to 64 lowercase hex characters — the canonical form emitted by
 * cf-esm-builder. The route handler re-validates the hash, but matching this
 * shape at the router level keeps legacy `/manifest/...` paths (if any are
 * ever added) from colliding with the new route.
 */
const MANIFEST_HASH_ROUTE = /^\/manifest\/([0-9a-f]{64})$/;

/**
 * Sim/device bundle fetch route. The manifest's `launchAsset.url`
 * points back at the relay's origin at `/<hash>.<platform>.bundle`,
 * so we proxy that to the matching `/bundle/<hash>/index.<platform>.bundle`
 * path on cf-esm-cache. Hermes bytecode is immutable per hash, so the
 * response headers are immutable-cacheable.
 */
const USER_BUNDLE_ROUTE = /^\/([0-9a-f]{64})\.(ios|android)\.bundle$/;
const BASE_BUNDLE_ROUTE_PREFIXES = ['/base-bundle', '/base-bundles'] as const;
const BASE_BUNDLE_STUB_BODY =
    'expo-relay: base-bundle routes are not implemented yet';

/**
 * Session ids for the two-tier overlay channel. Constrained to URL-safe
 * characters so we can round-trip them through `idFromName` without
 * surprises. The regex is tight on purpose — callers that need richer names
 * should hash them before issuing the request.
 */
const HMR_SESSION_ID = /^[A-Za-z0-9_-]{1,128}$/;
const HMR_WS_ROUTE = /^\/hmr\/([^/]+)$/;
const PUSH_ROUTE = /^\/push\/([^/]+)$/;

function parseSessionRoute(pathname: string): ParsedSessionRoute | null {
    // Expected shapes:
    //   /session/:id
    //   /session/:id/manifest
    //   /session/:id/bundle.js
    const segments = pathname.split('/').filter((s) => s.length > 0);
    if (segments.length < 2 || segments[0] !== 'session') {
        return null;
    }
    const sessionId = segments[1];
    if (!sessionId) {
        return null;
    }
    const rest = segments.slice(2).join('/');
    const subPath = rest.length > 0 ? `/${rest}` : '/';
    return { sessionId, subPath };
}

function isBaseBundleRoute(pathname: string): boolean {
    return BASE_BUNDLE_ROUTE_PREFIXES.some(
        (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
    );
}

function stripTrailingSlashWorker(url: string): string {
    return url.replace(/\/+$/, '');
}

function handleBaseBundleRouteStub(): Response {
    return new Response(BASE_BUNDLE_STUB_BODY, {
        status: 501,
        headers: {
            'Cache-Control': 'no-store',
        },
    });
}

async function handleBaseBundleFamily(
    request: Request,
    env: Env,
): Promise<Response> {
    // Both routes require the BASE_BUNDLES R2 binding. In environments
    // where it's absent (e.g. local dev without wrangler r2 setup), keep
    // the 501 stub so misconfiguration is surfaced, not swallowed.
    if (!env.BASE_BUNDLES) {
        return handleBaseBundleRouteStub();
    }

    // Assets live at `/base-bundle/assets/<key>` — always 3+ path segments,
    // so we check that family first. The bundle handler parses
    // `/base-bundle/<64hex>` (exactly 2 segments), so there's no overlap.
    if (parseBaseBundleAssetsRoute(request)) {
        return handleBaseBundleAssetsRoute(request, env);
    }

    return handleBaseBundle(request, env as Env & { BASE_BUNDLES: R2Bucket });
}

/**
 * Cross-origin hosts the editor can POST overlays from. The production
 * editor runs on a different origin to the relay, so /push must include
 * CORS headers. Read from the ALLOWED_PUSH_ORIGINS env var (comma-separated
 * list). If unset, reflect any origin — safe in dev, and the /push body is
 * still validated by HmrSession before anything is broadcast.
 */
function corsHeadersFor(request: Request, env: Env): Record<string, string> {
    const origin = request.headers.get('Origin');
    if (!origin) {
        return {};
    }
    const allowlist = env.ALLOWED_PUSH_ORIGINS;
    const isAllowed = !allowlist
        ? true
        : allowlist.split(',').map((s) => s.trim()).filter(Boolean).includes(origin);
    if (!isAllowed) {
        return {};
    }
    return {
        'Access-Control-Allow-Origin': origin,
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Max-Age': '600',
        Vary: 'Origin',
    };
}

function withCors(
    response: Response,
    headers: Record<string, string>,
): Response {
    if (Object.keys(headers).length === 0) {
        return response;
    }
    const merged = new Headers(response.headers);
    for (const [k, v] of Object.entries(headers)) {
        merged.set(k, v);
    }
    return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers: merged,
    });
}

export default {
    async fetch(request: Request, env: Env): Promise<Response> {
        const url = new URL(request.url);

        // TQ1.4: `/manifest/:bundleHash` takes precedence over any legacy
        // manifest routing. We match the strict 64-hex shape before falling
        // through to the session router so a malformed hash 404s cleanly.
        if (request.method === 'GET') {
            const manifestMatch = url.pathname.match(MANIFEST_HASH_ROUTE);
            if (manifestMatch) {
                const bundleHash = manifestMatch[1];
                if (bundleHash) {
                    return handleManifest(request, env, bundleHash);
                }
            }
        }

        if (isBaseBundleRoute(url.pathname)) {
            return handleBaseBundleFamily(request, env);
        }

        // Sim fetches the user bundle via the launchAsset.url the
        // manifest builds. Proxy to cf-esm-cache via ESM_CACHE service
        // binding when available; fall back to direct fetch for local
        // dev where the binding is absent.
        if (request.method === 'GET') {
            const bundleMatch = url.pathname.match(USER_BUNDLE_ROUTE);
            if (bundleMatch) {
                const [, hash, platform] = bundleMatch;
                const upstream = `${stripTrailingSlashWorker(env.ESM_CACHE_URL)}/bundle/${hash}/index.${platform}.bundle`;
                const req = new Request(upstream, { method: 'GET' });
                const resp = env.ESM_CACHE
                    ? await env.ESM_CACHE.fetch(req)
                    : await fetch(req);
                if (!resp.ok) {
                    return new Response(`expo-relay: bundle ${resp.status}`, {
                        status: resp.status,
                    });
                }
                return new Response(resp.body, {
                    status: 200,
                    headers: {
                        'Content-Type': 'application/javascript',
                        'Cache-Control': 'public, max-age=31536000, immutable',
                        ETag: `"${hash}"`,
                    },
                });
            }
        }

        // Two-tier overlay channel. These routes require the HMR_SESSION DO
        // binding; without it we return 503 so ops can tell misconfiguration
        // apart from "unknown route".
        const hmrUpgrade = request.headers.get('Upgrade');
        const hmrWsMatch = url.pathname.match(HMR_WS_ROUTE);
        if (hmrWsMatch && hmrUpgrade !== null && hmrUpgrade.toLowerCase() === 'websocket') {
            const sessionId = hmrWsMatch[1];
            if (!sessionId || !HMR_SESSION_ID.test(sessionId)) {
                return new Response('expo-relay: invalid hmr session id', { status: 400 });
            }
            if (!env.HMR_SESSION) {
                return new Response('expo-relay: HMR_SESSION binding missing', { status: 503 });
            }
            const id = env.HMR_SESSION.idFromName(sessionId);
            const stub = env.HMR_SESSION.get(id);
            const forwardUrl = new URL(request.url);
            forwardUrl.pathname = '/';
            return stub.fetch(new Request(forwardUrl.toString(), request));
        }

        // CORS preflight for /push/:sessionId — the editor runs on a
        // different origin than the relay in production.
        const pushMatchForCors = url.pathname.match(PUSH_ROUTE);
        if (pushMatchForCors && request.method === 'OPTIONS') {
            const cors = corsHeadersFor(request, env);
            return new Response(null, { status: 204, headers: cors });
        }

        if (request.method === 'POST') {
            const pushMatch = url.pathname.match(PUSH_ROUTE);
            if (pushMatch) {
                const sessionId = pushMatch[1];
                const cors = corsHeadersFor(request, env);
                if (!sessionId || !HMR_SESSION_ID.test(sessionId)) {
                    return withCors(
                        new Response('expo-relay: invalid push session id', { status: 400 }),
                        cors,
                    );
                }
                if (!env.HMR_SESSION) {
                    return withCors(
                        new Response('expo-relay: HMR_SESSION binding missing', { status: 503 }),
                        cors,
                    );
                }
                const id = env.HMR_SESSION.idFromName(sessionId);
                const stub = env.HMR_SESSION.get(id);
                const forwardUrl = new URL(request.url);
                forwardUrl.pathname = '/push';
                const doResponse = await stub.fetch(new Request(forwardUrl.toString(), request));
                return withCors(doResponse, cors);
            }
        }

        const route = parseSessionRoute(url.pathname);

        if (!route) {
            return new Response('expo-relay: unknown route', { status: 404 });
        }

        const upgrade = request.headers.get('Upgrade');
        const isWebSocket = upgrade !== null && upgrade.toLowerCase() === 'websocket';

        if (isWebSocket) {
            // WS  /session/:id  -> forward as `/` to the DO
            if (route.subPath !== '/') {
                return new Response('expo-relay: unknown route', { status: 404 });
            }
            const id = env.EXPO_SESSION.idFromName(route.sessionId);
            const stub = env.EXPO_SESSION.get(id);
            const forwardUrl = new URL(request.url);
            forwardUrl.pathname = '/';
            return stub.fetch(new Request(forwardUrl.toString(), request));
        }

        if (request.method === 'GET' && (route.subPath === '/manifest' || route.subPath === '/bundle.js')) {
            const id = env.EXPO_SESSION.idFromName(route.sessionId);
            const stub = env.EXPO_SESSION.get(id);
            const forwardUrl = new URL(request.url);
            forwardUrl.pathname = route.subPath;
            return stub.fetch(new Request(forwardUrl.toString(), request));
        }

        return new Response('expo-relay: unknown route', { status: 404 });
    },
} satisfies ExportedHandler<Env>;

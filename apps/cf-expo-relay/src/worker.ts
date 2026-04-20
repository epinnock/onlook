/**
 * cf-expo-relay Worker.
 *
 * Relays JS bundles between an editor browser tab (which uploads bundles via
 * a WebSocket) and Expo Go on a user's phone (which fetches the manifest /
 * bundle over HTTP).
 *
 * Routes:
 *   GET /manifest/:bundleHash   -> handleManifest (TQ1.2, 64-hex only)
 *   ANY /base-bundle[/...]      -> 501 stub (Q0-23, route family reserved)
 *   ANY /base-bundles[/...]     -> 501 stub (Q0-23, route family reserved)
 *   GET /session/:id/manifest   -> forwarded to ExpoSession DO (legacy)
 *   GET /session/:id/bundle.js  -> forwarded to ExpoSession DO (legacy)
 *   WS  /session/:id            -> upgraded + forwarded to ExpoSession DO
 *   *                            -> 404 "expo-relay: unknown route"
 *
 * Each session id maps to a Durable Object instance via
 * `EXPO_SESSION.idFromName(sessionId)`.
 */
import { handleManifest } from './routes/manifest';
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
const BASE_BUNDLE_ROUTE_PREFIXES = ['/base-bundle', '/base-bundles'] as const;
const BASE_BUNDLE_STUB_BODY =
    'expo-relay: base-bundle routes are not implemented yet';

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

function handleBaseBundleRouteStub(): Response {
    return new Response(BASE_BUNDLE_STUB_BODY, {
        status: 501,
        headers: {
            'Cache-Control': 'no-store',
        },
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
            return handleBaseBundleRouteStub();
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

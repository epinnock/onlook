/**
 * cf-expo-relay Worker.
 *
 * Relays JS bundles between an editor browser tab (which uploads bundles via
 * a WebSocket) and Expo Go on a user's phone (which fetches the manifest /
 * bundle over HTTP).
 *
 * Routes:
 *   GET /session/:id/manifest   -> forwarded to ExpoSession DO
 *   GET /session/:id/bundle.js  -> forwarded to ExpoSession DO
 *   WS  /session/:id            -> upgraded + forwarded to ExpoSession DO
 *   *                            -> 404 "expo-relay: unknown route"
 *
 * Each session id maps to a Durable Object instance via
 * `EXPO_SESSION.idFromName(sessionId)`.
 */
import { ExpoSession } from './session';

export { ExpoSession };

export interface Env {
    BUNDLES: KVNamespace;
    EXPO_SESSION: DurableObjectNamespace<import('./session').ExpoSession>;
}

interface ParsedSessionRoute {
    sessionId: string;
    /** The remainder of the path forwarded to the DO, always starting with `/`. */
    subPath: string;
}

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

export default {
    async fetch(request: Request, env: Env): Promise<Response> {
        const url = new URL(request.url);
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

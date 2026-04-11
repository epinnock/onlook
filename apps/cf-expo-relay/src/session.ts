/**
 * ExpoSession Durable Object.
 *
 * Thin port of the source plan §3.1 in
 * `plans/implementation-plan-expo-build.md`. One DO instance per Expo dev
 * session keeps a WebSocket open to the editor browser tab, accepts pushed
 * bundles, and stores them in KV so Expo Go on the user's phone can pull the
 * manifest + bundle over HTTP.
 *
 * The session id maps to the URL path segment after `/session/` in the parent
 * Worker (`src/worker.ts`), and is resolved to this DO via
 * `EXPO_SESSION.idFromName(sessionId)`.
 */
import { DurableObject } from 'cloudflare:workers';

interface Env {
    BUNDLES: KVNamespace;
    EXPO_SESSION: DurableObjectNamespace<ExpoSession>;
}

interface BundleMessage {
    type: 'bundle';
    sessionId: string;
    bundle: string;
}

function isBundleMessage(value: unknown): value is BundleMessage {
    if (typeof value !== 'object' || value === null) {
        return false;
    }
    const candidate = value as Record<string, unknown>;
    return (
        candidate.type === 'bundle' &&
        typeof candidate.sessionId === 'string' &&
        typeof candidate.bundle === 'string'
    );
}

export class ExpoSession extends DurableObject<Env> {
    constructor(state: DurableObjectState, env: Env) {
        super(state, env);
    }

    override async fetch(request: Request): Promise<Response> {
        const url = new URL(request.url);
        const upgrade = request.headers.get('Upgrade');

        if (upgrade !== null && upgrade.toLowerCase() === 'websocket') {
            return this.handleWebSocket();
        }

        if (request.method === 'GET' && url.pathname === '/manifest') {
            return this.handleManifest(url);
        }

        if (request.method === 'GET' && url.pathname === '/bundle.js') {
            return this.handleBundle(url);
        }

        return new Response('expo-relay: unknown route', { status: 404 });
    }

    private handleManifest(url: URL): Response {
        const sessionId = this.ctx.id.name ?? this.ctx.id.toString();
        const bundleUrl = `${url.origin}/session/${sessionId}/bundle.js`;
        const manifest = {
            name: 'playground',
            slug: 'playground',
            version: '1.0.0',
            sdkVersion: '52.0.0',
            bundleUrl,
        };
        return new Response(JSON.stringify(manifest), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
        });
    }

    private async handleBundle(_url: URL): Promise<Response> {
        const sessionId = this.ctx.id.name ?? this.ctx.id.toString();
        const bundle = await this.env.BUNDLES.get(`bundle:${sessionId}`);
        if (bundle === null) {
            return new Response('no bundle', { status: 404 });
        }
        return new Response(bundle, {
            status: 200,
            headers: { 'Content-Type': 'application/javascript' },
        });
    }

    private handleWebSocket(): Response {
        const [client, server] = Object.values(new WebSocketPair()) as [WebSocket, WebSocket];
        server.accept();

        server.addEventListener('message', (event: MessageEvent) => {
            void this.onMessage(event).catch((err) => {
                console.error('expo-relay ws message error', err);
            });
        });

        return new Response(null, { status: 101, webSocket: client });
    }

    private async onMessage(event: MessageEvent): Promise<void> {
        const raw = event.data;
        if (typeof raw !== 'string') {
            return;
        }
        let parsed: unknown;
        try {
            parsed = JSON.parse(raw);
        } catch {
            return;
        }
        if (!isBundleMessage(parsed)) {
            return;
        }
        await this.env.BUNDLES.put(`bundle:${parsed.sessionId}`, parsed.bundle, {
            expirationTtl: 3600,
        });
    }
}

import { DurableObject } from 'cloudflare:workers';

interface Env {}

export class HmrSession extends DurableObject<Env> {
    constructor(state: DurableObjectState, env: Env) {
        super(state, env);
    }

    override async fetch(request: Request): Promise<Response> {
        const url = new URL(request.url);
        const upgrade = request.headers.get('Upgrade');

        if (
            request.method === 'GET' &&
            url.pathname === '/' &&
            upgrade !== null &&
            upgrade.toLowerCase() === 'websocket'
        ) {
            return this.handleWebSocket();
        }

        return new Response('hmr-relay: unknown route', { status: 404 });
    }

    private handleWebSocket(): Response {
        const [client, server] = Object.values(new WebSocketPair()) as [WebSocket, WebSocket];
        server.accept();

        return new Response(null, { status: 101, webSocket: client });
    }
}

import { DurableObject } from 'cloudflare:workers';
import { isOverlayMessage } from '../../../../packages/mobile-client-protocol/src/overlay.ts';

/**
 * Upper bound on the POST /push body size. 2 MiB is well above any overlay
 * the browser-bundler produces today (tabs-template is ~400KB wrapped) but
 * still under the Cloudflare Workers request body limit, so the relay can
 * reject obvious abuse before the runtime does.
 */
const MAX_OVERLAY_BODY_BYTES = 2 * 1024 * 1024;

interface Env {}

type HmrSessionStorage = Pick<DurableObjectStorage, 'get' | 'put'>;

export class HmrSession extends DurableObject<Env> {
    private readonly sockets = new Set<WebSocket>();
    private readonly storage: HmrSessionStorage | null;
    private lastOverlayPayload: string | null = null;

    constructor(state: DurableObjectState, env: Env) {
        super(state, env);
        const storage = (state as DurableObjectState & { storage?: HmrSessionStorage }).storage;
        this.storage = storage ?? null;
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
            return await this.handleWebSocket();
        }

        if (request.method === 'POST' && url.pathname === '/push') {
            return await this.handlePush(request);
        }

        return new Response('hmr-relay: unknown route', { status: 404 });
    }

    private async handlePush(request: Request): Promise<Response> {
        const contentType = request.headers.get('Content-Type') ?? '';
        if (!contentType.toLowerCase().includes('application/json')) {
            return new Response('hmr-relay: expected application/json', { status: 415 });
        }

        // Advisory check — the Workers runtime will also refuse oversized
        // bodies, but an explicit 413 keeps the editor's error surfacing
        // precise. Headers may be missing or lying; the JSON read below
        // catches anything that slips through.
        const declaredLength = Number(request.headers.get('Content-Length') ?? 'NaN');
        if (Number.isFinite(declaredLength) && declaredLength > MAX_OVERLAY_BODY_BYTES) {
            return new Response('hmr-relay: overlay body too large', { status: 413 });
        }

        let rawBody: string;
        try {
            rawBody = await request.text();
        } catch {
            return new Response('hmr-relay: failed to read body', { status: 400 });
        }

        if (rawBody.length > MAX_OVERLAY_BODY_BYTES) {
            return new Response('hmr-relay: overlay body too large', { status: 413 });
        }

        let parsed: unknown;
        try {
            parsed = JSON.parse(rawBody);
        } catch {
            return new Response('hmr-relay: invalid JSON body', { status: 400 });
        }

        if (!isOverlayMessage(parsed)) {
            return new Response('hmr-relay: invalid overlay payload', { status: 400 });
        }

        const payload = JSON.stringify(parsed);
        this.saveLastOverlayPayload(payload);

        let delivered = 0;
        for (const socket of this.sockets) {
            if (socket.readyState !== WebSocket.OPEN) {
                continue;
            }
            socket.send(payload);
            delivered += 1;
        }

        // Structured log so Workers tail / log drains can surface fan-out
        // metrics. Kept to a single line per push for grep-ability.
        console.info(
            JSON.stringify({
                event: 'hmr.push',
                delivered,
                bytes: payload.length,
                sockets: this.sockets.size,
            }),
        );

        return new Response(JSON.stringify({ delivered }), {
            status: 202,
            headers: { 'Content-Type': 'application/json' },
        });
    }

    private async handleWebSocket(): Promise<Response> {
        const [client, server] = Object.values(new WebSocketPair()) as [WebSocket, WebSocket];
        server.accept();
        this.sockets.add(server);

        await this.replayLastOverlay(server);

        server.addEventListener('message', (event: MessageEvent) => {
            void this.onMessage(server, event);
        });

        const cleanup = (): void => {
            this.sockets.delete(server);
        };

        server.addEventListener('close', cleanup);
        server.addEventListener('error', cleanup);

        return new Response(null, { status: 101, webSocket: client });
    }

    private async replayLastOverlay(socket: WebSocket): Promise<void> {
        const payload = await this.loadLastOverlayPayload();
        if (payload === null || socket.readyState !== WebSocket.OPEN) {
            return;
        }
        socket.send(payload);
    }

    private async loadLastOverlayPayload(): Promise<string | null> {
        if (this.lastOverlayPayload !== null) {
            return this.lastOverlayPayload;
        }

        if (this.storage === null) {
            return null;
        }

        const stored = (await this.storage.get('last-overlay')) as string | null;
        if (typeof stored === 'string') {
            this.lastOverlayPayload = stored;
        }
        return this.lastOverlayPayload;
    }

    private saveLastOverlayPayload(payload: string): void {
        this.lastOverlayPayload = payload;
        if (this.storage === null) {
            return;
        }

        void this.storage.put('last-overlay', payload).catch((err) => {
            console.error('hmr-relay storage write error', err);
        });
    }

    private async onMessage(sender: WebSocket, event: MessageEvent): Promise<void> {
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

        if (!isOverlayMessage(parsed)) {
            return;
        }

        const payload = JSON.stringify(parsed);
        this.saveLastOverlayPayload(payload);
        for (const socket of this.sockets) {
            if (socket === sender || socket.readyState !== WebSocket.OPEN) {
                continue;
            }
            socket.send(payload);
        }
    }
}

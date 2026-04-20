import { DurableObject } from 'cloudflare:workers';
import { isOverlayMessage } from '../../../../packages/mobile-client-protocol/src/overlay.ts';

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

        return new Response('hmr-relay: unknown route', { status: 404 });
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

import { DurableObject } from 'cloudflare:workers';
import { isOverlayMessage } from '../../../../packages/mobile-client-protocol/src/overlay.ts';
import {
    OverlayUpdateMessageSchema,
    type OverlayUpdateMessage,
} from '../../../../packages/mobile-client-protocol/src/abi-v1.ts';
import { WsMessageSchema } from '../../../../packages/mobile-client-protocol/src/ws-messages.ts';
import { OverlayAckMessageSchema } from '../../../../packages/mobile-client-protocol/src/abi-v1.ts';

/** Any phone→editor onlook:* message type that the relay just fans out. */
const ONLOOK_OBSERVABILITY_TYPES: ReadonlySet<string> = new Set([
    'onlook:select',
    'onlook:tap',
    'onlook:console',
    'onlook:network',
    'onlook:error',
    'onlook:overlayAck',
]);

function isOnlookObservabilityType(value: unknown): boolean {
    if (typeof value !== 'object' || value === null) return false;
    const t = (value as { type?: unknown }).type;
    return typeof t === 'string' && ONLOOK_OBSERVABILITY_TYPES.has(t);
}

/**
 * Upper bound on the POST /push body size. 2 MiB is well above any overlay
 * the browser-bundler produces today (tabs-template is ~400KB wrapped) but
 * still under the Cloudflare Workers request body limit, so the relay can
 * reject obvious abuse before the runtime does.
 */
const MAX_OVERLAY_BODY_BYTES = 2 * 1024 * 1024;
// Soft-cap matches OVERLAY_SIZE_SOFT_CAP in @onlook/browser-bundler —
// duplicated inline so the relay doesn't gain a cross-package dep in
// the workerd-compiled bundle. Overlays > this size still pass through
// (hard cap is MAX_OVERLAY_BODY_BYTES) but emit a warning log so
// observability pipelines can surface creeping bundle bloat.
const OVERLAY_SOFT_CAP_BYTES = 512 * 1024;

interface Env {}

type HmrSessionStorage = Pick<DurableObjectStorage, 'get' | 'put'> &
    Partial<Pick<DurableObjectStorage, 'delete'>>;

export class HmrSession extends DurableObject<Env> {
    private readonly sockets = new Set<WebSocket>();
    private readonly storage: HmrSessionStorage | null;
    private lastOverlayPayload: string | null = null;
    /** Most recently pushed ABI v1 overlayUpdate payload — replayed to late-joining v1 clients. */
    private lastOverlayV1Payload: string | null = null;

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

        // ABI v1: overlayUpdate messages take precedence. Fall through to legacy
        // `overlay` shape when v1 doesn't match, so the single /push endpoint
        // accepts both dialects during migration.
        const v1Parse = OverlayUpdateMessageSchema.safeParse(parsed);
        if (v1Parse.success) {
            const payload = JSON.stringify(v1Parse.data satisfies OverlayUpdateMessage);
            this.saveLastOverlayV1Payload(payload);
            let delivered = 0;
            for (const socket of this.sockets) {
                if (socket.readyState !== WebSocket.OPEN) continue;
                socket.send(payload);
                delivered += 1;
            }
            const sourceBytes = (() => {
                try {
                    return new TextEncoder().encode(v1Parse.data.source).byteLength;
                } catch {
                    return v1Parse.data.source.length;
                }
            })();
            const exceedsSoftCap = sourceBytes > OVERLAY_SOFT_CAP_BYTES;
            console.info(
                JSON.stringify({
                    event: 'hmr.push.v1',
                    delivered,
                    bytes: payload.length,
                    sourceBytes,
                    sockets: this.sockets.size,
                    overlayHash: v1Parse.data.meta.overlayHash,
                    // Editor-reported build duration — included so Phase 11b
                    // soak telemetry can join push-side latency with on-
                    // device mount latency via overlayHash correlation.
                    buildDurationMs: v1Parse.data.meta.buildDurationMs,
                    ...(exceedsSoftCap ? { softCapExceeded: true } : {}),
                }),
            );
            if (exceedsSoftCap) {
                console.warn(
                    JSON.stringify({
                        event: 'hmr.push.v1.softcap',
                        sourceBytes,
                        softCap: OVERLAY_SOFT_CAP_BYTES,
                        overlayHash: v1Parse.data.meta.overlayHash,
                    }),
                );
            }
            return new Response(JSON.stringify({ delivered }), {
                status: 202,
                headers: { 'Content-Type': 'application/json' },
            });
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
        // v1 replay first: if a v1 overlay was pushed in this session (or persisted
        // in DO storage from a prior one), send that. Legacy `overlay` replay only
        // fires if there's no v1 overlay — a v1 client will ignore the legacy shape
        // and vice versa, so sending both is safe, but single-send keeps traffic tight.
        const v1Payload = await this.loadLastOverlayV1Payload();
        if (v1Payload !== null && socket.readyState === WebSocket.OPEN) {
            socket.send(v1Payload);
            return;
        }
        const payload = await this.loadLastOverlayPayload();
        if (payload === null || socket.readyState !== WebSocket.OPEN) {
            return;
        }
        socket.send(payload);
    }

    private async loadLastOverlayV1Payload(): Promise<string | null> {
        if (this.lastOverlayV1Payload !== null) {
            return this.lastOverlayV1Payload;
        }
        if (this.storage === null) {
            return null;
        }
        const stored = (await this.storage.get('last-overlay-v1')) as string | null;
        if (typeof stored === 'string') {
            this.lastOverlayV1Payload = stored;
        }
        return this.lastOverlayV1Payload;
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
        // A legacy push supersedes any prior v1 payload for replay purposes —
        // clear both the in-memory slot and the durable key so reconnecting
        // clients get the FRESH legacy overlay, not a stale v1 envelope left
        // over from earlier in the session (e.g. mid-session flag flip).
        this.lastOverlayV1Payload = null;
        if (this.storage === null) {
            return;
        }
        void this.storage.put('last-overlay', payload).catch((err) => {
            console.error('hmr-relay storage write error', err);
        });
        // `delete` is optional on the storage binding — older mocks + tests
        // may not implement it. Skip cleanly when absent.
        if (typeof this.storage.delete === 'function') {
            void this.storage.delete('last-overlay-v1').catch((err) => {
                console.error('hmr-relay v1 storage clear error', err);
            });
        }
    }

    /**
     * Store a v1 OverlayUpdateMessage payload and invalidate any stale
     * legacy payload. Same last-write-wins semantics as
     * {@link saveLastOverlayPayload} but for the v1 wire shape.
     */
    private saveLastOverlayV1Payload(payload: string): void {
        this.lastOverlayV1Payload = payload;
        // A v1 push supersedes any prior legacy payload.
        this.lastOverlayPayload = null;
        if (this.storage === null) {
            return;
        }
        void this.storage.put('last-overlay-v1', payload).catch((err) => {
            console.error('hmr-relay v1 storage write error', err);
        });
        if (typeof this.storage.delete === 'function') {
            void this.storage.delete('last-overlay').catch((err) => {
                console.error('hmr-relay legacy storage clear error', err);
            });
        }
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

        // Phone→editor observability messages (onlook:console/network/error/select/tap/overlayAck) —
        // validated via WsMessageSchema or OverlayAckMessageSchema then fanned out to
        // every OTHER socket. Task #72 + #60 of two-tier-overlay-v2.
        if (isOnlookObservabilityType(parsed)) {
            // onlook:overlayAck lives in abi-v1.ts (not in the legacy ws-messages union),
            // so validate separately. Fall through to WsMessageSchema for the legacy set.
            const ackParse = OverlayAckMessageSchema.safeParse(parsed);
            if (ackParse.success) {
                const payload = JSON.stringify(ackParse.data);
                let delivered = 0;
                for (const socket of this.sockets) {
                    if (socket === sender || socket.readyState !== WebSocket.OPEN) continue;
                    socket.send(payload);
                    delivered += 1;
                }
                // Structured log mirroring the push-side `hmr.push.v1` line so
                // operators watching Workers tail / log drains can correlate
                // push → ack pairs. mountDurationMs is surfaced explicitly
                // (when populated by the phone) since it's the Phase 11b Q5b
                // eval-latency signal — watching logs is the fallback for
                // operators without the PostHog dashboard live yet.
                console.info(
                    JSON.stringify({
                        event: 'hmr.ack.v1',
                        sessionId: ackParse.data.sessionId,
                        overlayHash: ackParse.data.overlayHash,
                        status: ackParse.data.status,
                        delivered,
                        mountDurationMs: ackParse.data.mountDurationMs,
                        errorKind: ackParse.data.error?.kind,
                    }),
                );
                return;
            }
            const obsParse = WsMessageSchema.safeParse(parsed);
            if (obsParse.success) {
                const payload = JSON.stringify(obsParse.data);
                for (const socket of this.sockets) {
                    if (socket === sender || socket.readyState !== WebSocket.OPEN) {
                        continue;
                    }
                    socket.send(payload);
                }
                return;
            }
            // Malformed onlook:* — drop silently rather than forwarding garbage.
            console.warn(
                'hmr-relay: dropped malformed onlook observability message',
                obsParse.error.message,
            );
            return;
        }

        // ABI v1: fan-out overlayUpdate messages independently of legacy replay state.
        const v1Parse = OverlayUpdateMessageSchema.safeParse(parsed);
        if (v1Parse.success) {
            const payload = JSON.stringify(v1Parse.data satisfies OverlayUpdateMessage);
            this.saveLastOverlayV1Payload(payload);
            for (const socket of this.sockets) {
                if (socket === sender || socket.readyState !== WebSocket.OPEN) {
                    continue;
                }
                socket.send(payload);
            }
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

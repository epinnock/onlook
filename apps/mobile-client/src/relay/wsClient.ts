/**
 * WebSocket client for the Onlook relay server.
 *
 * Connects to the relay's `/ws` upgrade path and handles message framing per
 * the `@onlook/mobile-client-protocol` WS message types. Incoming messages are
 * validated through the `WsMessageSchema` Zod discriminated union before being
 * dispatched to registered handlers.
 *
 * Features:
 *   - Typed message dispatch via `WsMessageSchema` from the protocol package.
 *   - Listener-array pattern (no EventEmitter dependency).
 *   - Auto-reconnect with exponential backoff (configurable, capped at 30s).
 *
 * Task: MC3.13
 */

import { WsMessageSchema } from '@onlook/mobile-client-protocol';
import type { WsMessage } from '@onlook/mobile-client-protocol';

export type { WsMessage };

/** Configuration options for `OnlookRelayClient`. */
export interface RelayClientOptions {
    /** Whether to automatically reconnect on unexpected close. Defaults to `true`. */
    autoReconnect?: boolean;
    /** Maximum delay between reconnect attempts in milliseconds. Defaults to `30_000`. */
    maxReconnectDelay?: number;
}

const DEFAULT_RECONNECT_DELAY = 1_000;
const DEFAULT_MAX_RECONNECT_DELAY = 30_000;

/**
 * WebSocket client that connects to the Onlook relay server and dispatches
 * typed messages to registered handlers.
 */
export class OnlookRelayClient {
    private readonly wsUrl: string;
    private readonly autoReconnect: boolean;
    private readonly maxReconnectDelay: number;
    private ws: WebSocket | null = null;
    private listeners = new Set<(msg: WsMessage) => void>();
    private reconnectDelay = DEFAULT_RECONNECT_DELAY;
    private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    private intentionalClose = false;

    constructor(wsUrl: string, options?: RelayClientOptions) {
        this.wsUrl = wsUrl;
        this.autoReconnect = options?.autoReconnect ?? true;
        this.maxReconnectDelay = options?.maxReconnectDelay ?? DEFAULT_MAX_RECONNECT_DELAY;
    }

    /** Whether the underlying WebSocket is currently in the OPEN state. */
    get isConnected(): boolean {
        return this.ws?.readyState === WebSocket.OPEN;
    }

    /**
     * Open a WebSocket connection to the relay.
     *
     * Safe to call multiple times — if already connected the call is a no-op.
     */
    connect(): void {
        if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
            return;
        }

        this.intentionalClose = false;
        this.clearReconnectTimer();

        const ws = new WebSocket(this.wsUrl);

        ws.onopen = () => {
            // Reset backoff on successful connection.
            this.reconnectDelay = DEFAULT_RECONNECT_DELAY;
        };

        ws.onmessage = (event: MessageEvent) => {
            this.handleRawMessage(event.data);
        };

        ws.onclose = () => {
            this.ws = null;
            if (!this.intentionalClose && this.autoReconnect) {
                this.scheduleReconnect();
            }
        };

        ws.onerror = () => {
            // The `close` event always fires after `error`, so reconnect logic
            // is handled there. Nothing extra needed here.
        };

        this.ws = ws;
    }

    /**
     * Close the WebSocket connection. No reconnection will be attempted.
     */
    disconnect(): void {
        this.intentionalClose = true;
        this.clearReconnectTimer();
        if (this.ws) {
            this.ws.close();
            this.ws = null;
        }
    }

    /**
     * Register a handler for incoming parsed WS messages.
     *
     * @returns An unsubscribe function that removes the handler.
     */
    onMessage(handler: (msg: WsMessage) => void): () => void {
        this.listeners.add(handler);
        return () => {
            this.listeners.delete(handler);
        };
    }

    /**
     * Send a typed message to the relay.
     *
     * The message is JSON-serialised before sending. Throws if the socket is
     * not connected.
     */
    send(msg: WsMessage): void {
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
            throw new Error('WebSocket is not connected');
        }
        this.ws.send(JSON.stringify(msg));
    }

    // ── private ──────────────────────────────────────────────────────────

    private handleRawMessage(data: unknown): void {
        if (typeof data !== 'string') {
            // Binary frames are not part of the protocol — ignore silently.
            return;
        }

        let json: unknown;
        try {
            json = JSON.parse(data);
        } catch {
            // Invalid JSON — ignore per spec (no throw).
            return;
        }

        const result = WsMessageSchema.safeParse(json);
        if (!result.success) {
            // Message did not match any variant in the discriminated union — skip.
            return;
        }

        const msg = result.data;
        for (const listener of this.listeners) {
            listener(msg);
        }
    }

    private scheduleReconnect(): void {
        this.reconnectTimer = setTimeout(() => {
            this.reconnectTimer = null;
            this.connect();
        }, this.reconnectDelay);

        // Exponential backoff: double the delay, capped at maxReconnectDelay.
        this.reconnectDelay = Math.min(this.reconnectDelay * 2, this.maxReconnectDelay);
    }

    private clearReconnectTimer(): void {
        if (this.reconnectTimer !== null) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
        }
    }
}

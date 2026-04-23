/**
 * relay-ws-client.ts — editor-side WebSocket ingestor for the
 * cf-expo-relay `/hmr/:sessionId` channel.
 *
 * Opens a single WebSocket to the relay, plumbs it through
 * `subscribeRelayEvents` so each `onlook:*` kind routes to the right
 * handler, and maintains a bounded in-memory buffer of every parsed
 * message for the dev panel's `MobileConsoleTab` / `MobileNetworkTab`
 * (which accept `WsMessage[]` as a prop).
 *
 * The phone-side `onlook:overlayAck` pump (MCG.10 step 1) arrives here
 * via the `onOverlayAck` handler — closes the round-trip loop between
 * the phone's `mountOverlay` call and the editor's push-overlay ↔
 * push-completed UI signal.
 *
 * Design notes:
 *   - Pure TypeScript; no React, no MobX. React hooks / context can be
 *     layered on top later without pulling UI deps into the service layer.
 *   - WebSocket factory is injectable so bun:test can pass a fake; the
 *     default uses `globalThis.WebSocket`.
 *   - Auto-reconnect with exponential backoff (capped), disabled when
 *     the caller explicitly calls `disconnect()`.
 *   - Message buffer is capped (default 500 entries, FIFO) so long-lived
 *     sessions don't balloon memory.
 */

import type {
    ConsoleMessage,
    ErrorMessage,
    NetworkMessage,
    OverlayAckMessage,
    SelectMessage,
    TapMessage,
    WsMessage,
} from '@onlook/mobile-client-protocol';

import { subscribeRelayEvents, type RelayEventHandlers } from './relay-events';

const DEFAULT_MESSAGE_BUFFER = 500;
const DEFAULT_RECONNECT_MIN_MS = 500;
const DEFAULT_RECONNECT_MAX_MS = 15_000;

export type RelayWsOpenState = 'idle' | 'connecting' | 'open' | 'closed';

export interface RelayWsClientOptions {
    /**
     * Relay base URL — either `http(s)://host:port` or `ws(s)://host:port`.
     * The client upgrades http → ws and appends `/hmr/:sessionId`.
     */
    readonly relayBaseUrl: string;
    readonly sessionId: string;
    /** Optional per-kind hooks. Fires on every valid message. */
    readonly handlers?: Omit<RelayEventHandlers, 'onAny'>;
    /** Fires on every valid parsed message regardless of kind. */
    readonly onAny?: (msg: WsMessage | OverlayAckMessage) => void;
    /**
     * Injectable WebSocket factory for tests. Defaults to
     * `(url) => new globalThis.WebSocket(url)`.
     */
    readonly createSocket?: (url: string) => WebSocket;
    /** Max messages retained in-buffer. Defaults to 500. FIFO drop. */
    readonly bufferSize?: number;
    /** `setTimeout` override for tests. Defaults to `globalThis.setTimeout`. */
    readonly setTimeout?: (fn: () => void, ms: number) => unknown;
    /** `clearTimeout` override for tests. */
    readonly clearTimeout?: (handle: unknown) => void;
    /** Min reconnect backoff in ms. Default 500. */
    readonly reconnectMinMs?: number;
    /** Max reconnect backoff in ms. Default 15000. */
    readonly reconnectMaxMs?: number;
    /** Called on every state transition — telemetry-only; pure observer. */
    readonly onStateChange?: (state: RelayWsOpenState) => void;
}

export interface RelayMessageSnapshot {
    readonly messages: ReadonlyArray<WsMessage | OverlayAckMessage>;
    readonly acks: readonly OverlayAckMessage[];
    readonly state: RelayWsOpenState;
}

function toWsUrl(relayBaseUrl: string, sessionId: string): string {
    const trimmed = relayBaseUrl.replace(/\/+$/, '');
    const wsBase = trimmed.replace(/^http:\/\//i, 'ws://').replace(/^https:\/\//i, 'wss://');
    return `${wsBase}/hmr/${encodeURIComponent(sessionId)}`;
}

/**
 * Editor-side relay WS ingestor. One instance per session; constructor
 * starts the first connection attempt. Call `disconnect()` to tear down.
 */
export class RelayWsClient {
    private socket: WebSocket | null = null;
    private stateValue: RelayWsOpenState = 'idle';
    private readonly url: string;
    private readonly messagesBuf: Array<WsMessage | OverlayAckMessage> = [];
    private readonly acksBuf: OverlayAckMessage[] = [];
    private readonly bufferSize: number;
    private readonly createSocket: (url: string) => WebSocket;
    private readonly setTimeoutFn: (fn: () => void, ms: number) => unknown;
    private readonly clearTimeoutFn: (handle: unknown) => void;
    private readonly reconnectMinMs: number;
    private readonly reconnectMaxMs: number;
    private reconnectAttempts = 0;
    private reconnectTimer: unknown = undefined;
    private subscription: ReturnType<typeof subscribeRelayEvents> | null = null;
    private disconnected = false;

    constructor(private readonly opts: RelayWsClientOptions) {
        this.url = toWsUrl(opts.relayBaseUrl, opts.sessionId);
        this.bufferSize = opts.bufferSize ?? DEFAULT_MESSAGE_BUFFER;
        this.createSocket =
            opts.createSocket ??
            ((target: string) => new globalThis.WebSocket(target));
        this.setTimeoutFn =
            opts.setTimeout ??
            (globalThis.setTimeout as unknown as RelayWsClientOptions['setTimeout'])!;
        this.clearTimeoutFn =
            opts.clearTimeout ??
            (globalThis.clearTimeout as unknown as RelayWsClientOptions['clearTimeout'])!;
        this.reconnectMinMs = opts.reconnectMinMs ?? DEFAULT_RECONNECT_MIN_MS;
        this.reconnectMaxMs = opts.reconnectMaxMs ?? DEFAULT_RECONNECT_MAX_MS;
        this.connect();
    }

    snapshot(): RelayMessageSnapshot {
        return {
            messages: this.messagesBuf.slice(),
            acks: this.acksBuf.slice(),
            state: this.stateValue,
        };
    }

    get state(): RelayWsOpenState {
        return this.stateValue;
    }

    /** Stop the ingestor. Closes the socket, cancels any queued reconnect. */
    disconnect(): void {
        if (this.disconnected) return;
        this.disconnected = true;
        if (this.reconnectTimer !== undefined) {
            this.clearTimeoutFn(this.reconnectTimer);
            this.reconnectTimer = undefined;
        }
        this.subscription?.cancel();
        this.subscription = null;
        const ws = this.socket;
        this.socket = null;
        try {
            ws?.close();
        } catch {
            /* ignore */
        }
        this.setState('closed');
    }

    private connect(): void {
        if (this.disconnected) return;
        this.setState('connecting');
        let ws: WebSocket;
        try {
            ws = this.createSocket(this.url);
        } catch {
            this.scheduleReconnect();
            return;
        }
        this.socket = ws;

        ws.addEventListener('open', () => {
            this.reconnectAttempts = 0;
            this.setState('open');
        });
        ws.addEventListener('close', () => {
            this.socket = null;
            this.subscription?.cancel();
            this.subscription = null;
            if (this.disconnected) return;
            this.setState('closed');
            this.scheduleReconnect();
        });
        ws.addEventListener('error', () => {
            // The matching 'close' event will fire too — reconnect is driven
            // from there so we don't double-schedule.
        });

        this.subscription = subscribeRelayEvents({
            ws,
            handlers: {
                ...this.opts.handlers,
                onAny: (msg) => {
                    this.pushMessage(msg);
                    if (msg.type === 'onlook:overlayAck') {
                        this.pushAck(msg);
                    }
                    this.opts.onAny?.(msg);
                },
            },
        });
    }

    private scheduleReconnect(): void {
        if (this.disconnected) return;
        const delay = Math.min(
            this.reconnectMaxMs,
            this.reconnectMinMs * 2 ** this.reconnectAttempts,
        );
        this.reconnectAttempts += 1;
        this.reconnectTimer = this.setTimeoutFn(() => {
            this.reconnectTimer = undefined;
            this.connect();
        }, delay);
    }

    private pushMessage(msg: WsMessage | OverlayAckMessage): void {
        this.messagesBuf.push(msg);
        if (this.messagesBuf.length > this.bufferSize) {
            this.messagesBuf.splice(0, this.messagesBuf.length - this.bufferSize);
        }
    }

    private pushAck(msg: OverlayAckMessage): void {
        this.acksBuf.push(msg);
        if (this.acksBuf.length > this.bufferSize) {
            this.acksBuf.splice(0, this.acksBuf.length - this.bufferSize);
        }
    }

    private setState(next: RelayWsOpenState): void {
        if (this.stateValue === next) return;
        this.stateValue = next;
        this.opts.onStateChange?.(next);
    }
}

export type {
    ConsoleMessage,
    ErrorMessage,
    NetworkMessage,
    OverlayAckMessage,
    SelectMessage,
    TapMessage,
    WsMessage,
};

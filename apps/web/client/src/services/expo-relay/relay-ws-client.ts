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
    AbiHelloMessage,
    ConsoleMessage,
    ErrorMessage,
    NetworkMessage,
    OnlookRuntimeError,
    OverlayAckMessage,
    RuntimeCapabilities,
    SelectMessage,
    TapMessage,
    WsMessage,
} from '@onlook/mobile-client-protocol';

import { ABI_VERSION, checkAbiCompatibility } from '@onlook/mobile-client-protocol';
import { startEditorAbiHandshake, type AbiHandshakeHandle } from './abi-hello';
import { subscribeRelayEvents, type RelayEventHandlers } from './relay-events';

/**
 * Cached AbiHello compatibility — surfaced via
 * {@link RelayWsClient.getLastAbiCompatibility} so push-overlay sites can
 * pass it to `pushOverlayV1`'s `compatibility` gate without subscribing
 * to onAbiCompatibility separately. Same shape as
 * `AbiHandshakeHandle.compatibility()` for symmetry.
 */
export type RelayWsCompatibility = 'unknown' | 'ok' | OnlookRuntimeError;

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
    /**
     * Editor capability handshake (Phase 11b prep). When set, the client
     * arms `startEditorAbiHandshake` on every WS open and re-arms on
     * auto-reconnect — sending the editor's hello immediately and listening
     * for the phone's. Push-overlay sites should gate sends on
     * {@link onAbiCompatibility} resolving to `'ok'`.
     *
     * Omit when the caller does not yet need the gate (e.g. legacy
     * `'two-tier'` pipeline) — the handshake is a no-op without
     * `editorCapabilities`.
     */
    readonly editorCapabilities?: RuntimeCapabilities;
    /**
     * Fires every time `compatibility()` would change — once per phone
     * hello received. Use this to flip a `canPushV1` flag in the editor's
     * mobile-preview pipeline. Symmetric to `onPhoneHello` in
     * `AbiHandshakeOptions`; the wrapper hides the handshake handle so
     * callers don't have to poll.
     */
    readonly onAbiCompatibility?: (
        result: 'ok' | OnlookRuntimeError,
        phoneHello: AbiHelloMessage,
    ) => void;
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
    private handshake: AbiHandshakeHandle | null = null;
    private lastCompatibility: RelayWsCompatibility = 'unknown';
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

    /**
     * Replace the first buffered message matching `predicate` with the
     * value returned by `replacer`. No-op when no entry matches.
     *
     * Phase 11b row #35 source-map decoration uses this to swap a raw
     * `onlook:error` entry with its source-map-decorated version once
     * the map resolves — without this primitive, the buffered messages
     * path would either show duplicate rows or the operator would
     * never see the resolved source frame. The middleware in
     * `source-map-cache.ts::withSourceMapDecoration` is shaped for
     * stream consumers; this method bridges to the buffer pattern.
     *
     * Match-by-identity in the simplest case (replacer returns a fresh
     * object with the same `(sessionId, timestamp)` pair); the dev panel's
     * downstream filters narrow by message type so the swap is
     * transparent to existing tabs.
     */
    replaceMessageMatching(
        predicate: (msg: WsMessage | OverlayAckMessage) => boolean,
        replacer: (
            msg: WsMessage | OverlayAckMessage,
        ) => WsMessage | OverlayAckMessage,
    ): boolean {
        const idx = this.messagesBuf.findIndex(predicate);
        if (idx === -1) return false;
        const replaced = replacer(this.messagesBuf[idx]!);
        this.messagesBuf[idx] = replaced;
        return true;
    }

    get state(): RelayWsOpenState {
        return this.stateValue;
    }

    /**
     * Latest AbiHello compatibility result. `'unknown'` until the phone's
     * hello arrives on the current socket; flips to `'ok'` or an
     * `OnlookRuntimeError` on receipt; resets to `'unknown'` on socket
     * close. Pass this directly to `pushOverlayV1`'s `compatibility` gate:
     *
     *   pushOverlayV1({ ..., compatibility: () => relayWs.getLastAbiCompatibility() })
     *
     * The gate fails-closed on `'unknown'`, so a stale-positive across a
     * phone restart cannot mask an incompatible push.
     */
    getLastAbiCompatibility(): RelayWsCompatibility {
        return this.lastCompatibility;
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
        this.handshake?.cancel();
        this.handshake = null;
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
            this.armAbiHandshake(ws);
        });
        ws.addEventListener('close', () => {
            this.socket = null;
            this.subscription?.cancel();
            this.subscription = null;
            this.handshake?.cancel();
            this.handshake = null;
            // Drop the cached compatibility on disconnect — the next
            // connection may land on a different phone (phone restart,
            // binary upgrade, foreground/background cycle), so a stale
            // 'ok' could let an incompatible push slip past the gate.
            // The handshake re-fires on the new socket's open event;
            // until then, `getLastAbiCompatibility` reports 'unknown'
            // which fail-closes pushOverlayV1.
            this.lastCompatibility = 'unknown';
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

    /**
     * Arm the editor-side AbiHello handshake on a freshly-opened socket.
     * No-op when `editorCapabilities` is not configured (legacy callers
     * stay opt-in until Phase 11b's pipeline default flip lands). Wraps
     * the immediate `ws.send` in try/catch — a hello-send failure must
     * not break the WS itself; the editor's `compatibility()` handle just
     * stays `'unknown'` and pushes already fail-closed on that state.
     */
    private armAbiHandshake(ws: WebSocket): void {
        const caps = this.opts.editorCapabilities;
        if (!caps) return;
        try {
            this.handshake = startEditorAbiHandshake({
                ws: ws as unknown as Parameters<typeof startEditorAbiHandshake>[0]['ws'],
                sessionId: this.opts.sessionId,
                capabilities: caps,
                onPhoneHello: (phone) => {
                    // `startEditorAbiHandshake` invokes `onPhoneHello`
                    // BEFORE it sets its internal `compatibility()` status,
                    // so polling the handle here would always see
                    // 'unknown'. Re-derive the same result locally —
                    // `checkAbiCompatibility` is pure, so the two derivations
                    // are guaranteed to agree. Cache it for
                    // `getLastAbiCompatibility` so push-overlay gate sites
                    // can read it without subscribing.
                    const compat = checkAbiCompatibility(ABI_VERSION, phone.runtime);
                    this.lastCompatibility = compat ?? 'ok';
                    this.opts.onAbiCompatibility?.(this.lastCompatibility, phone);
                },
            });
        } catch {
            // Send/listener wiring failure must not wedge the WS.
            this.handshake = null;
        }
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

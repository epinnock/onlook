import type { OverlayMessage } from '@onlook/mobile-client-protocol';
import { isOverlayMessage } from '@onlook/mobile-client-protocol';

/**
 * Overlay dispatcher — consumes the two-tier HmrSession `/hmr/:sessionId`
 * channel and hands off parsed overlay payloads to registered listeners.
 *
 * Separate from `LiveReloadDispatcher`/`OnlookRelayClient` on purpose: those
 * talk to the legacy single-bundle relay, while the two-tier bootstrap opens
 * an independent WebSocket against HmrSession. Keeping the clients isolated
 * means turning the two-tier path off (feature flag) leaves the existing
 * code paths untouched.
 *
 * The dispatcher does NOT call into OnlookRuntime directly. Native overlay
 * mount is wired at the app level via `onOverlay` listeners once the iOS
 * runtime bridge lands (blocked on Xcode 16.1; see plans/onlook-mobile-client-plan.md).
 */

export type OverlayListener = (message: OverlayMessage) => void;

export interface OverlayDispatcherOptions {
    /**
     * WebSocket factory. Defaults to `globalThis.WebSocket`. Injected in tests.
     */
    readonly createSocket?: (url: string) => WebSocket;
    /**
     * Called for any WS error the dispatcher swallows (non-JSON payload,
     * non-overlay shape). Defaults to `console.warn`.
     */
    readonly onProtocolError?: (reason: string, raw?: unknown) => void;
}

/**
 * Resolve the HmrSession WebSocket URL for a given relay host + session id.
 *
 * Accepts either an `http(s)://` or `ws(s)://` base URL — http/https get
 * upgraded to the equivalent ws/wss scheme to match how browsers handle
 * `Upgrade: websocket` requests.
 */
export function resolveHmrSessionUrl(relayBase: string, sessionId: string): string {
    const trimmed = relayBase.replace(/\/+$/, '');
    const wsBase = trimmed.replace(/^http:\/\//i, 'ws://').replace(/^https:\/\//i, 'wss://');
    return `${wsBase}/hmr/${encodeURIComponent(sessionId)}`;
}

export class OverlayDispatcher {
    private readonly url: string;
    private readonly createSocket: (url: string) => WebSocket;
    private readonly onProtocolError: (reason: string, raw?: unknown) => void;
    private readonly listeners = new Set<OverlayListener>();
    private socket: WebSocket | null = null;

    constructor(url: string, options: OverlayDispatcherOptions = {}) {
        this.url = url;
        this.createSocket =
            options.createSocket ?? ((target: string) => new globalThis.WebSocket(target));
        this.onProtocolError =
            options.onProtocolError ??
            ((reason, raw) => {
                console.warn('[overlay-dispatcher]', reason, raw);
            });
    }

    get isConnected(): boolean {
        return this.socket?.readyState === WebSocket.OPEN;
    }

    start(): void {
        if (this.socket) {
            return;
        }
        const ws = this.createSocket(this.url);
        this.socket = ws;
        ws.addEventListener('message', (event) => {
            this.handleRaw(event.data);
        });
        ws.addEventListener('close', () => {
            this.socket = null;
        });
    }

    stop(): void {
        if (!this.socket) {
            return;
        }
        try {
            this.socket.close();
        } finally {
            this.socket = null;
        }
    }

    /**
     * Write a payload to the HmrSession socket (phone → editor direction).
     * TCP send works on bridgeless iOS 18.6 even though receive-side event
     * dispatch is broken (ADR finding #8), so this is the supported path
     * for `onlook:overlayAck` and sibling observability messages.
     *
     * Returns `true` if the frame was handed to the socket. `false` when
     * the dispatcher isn't started or the socket isn't in OPEN state —
     * callers can drop the ack silently in that case.
     */
    send(payload: unknown): boolean {
        const ws = this.socket;
        if (!ws || ws.readyState !== WebSocket.OPEN) return false;
        try {
            ws.send(typeof payload === 'string' ? payload : JSON.stringify(payload));
            return true;
        } catch {
            return false;
        }
    }

    onOverlay(listener: OverlayListener): () => void {
        this.listeners.add(listener);
        return () => {
            this.listeners.delete(listener);
        };
    }

    private handleRaw(raw: unknown): void {
        if (typeof raw !== 'string') {
            this.onProtocolError('expected string WS payload', raw);
            return;
        }
        let parsed: unknown;
        try {
            parsed = JSON.parse(raw);
        } catch {
            this.onProtocolError('WS payload was not JSON', raw);
            return;
        }
        if (!isOverlayMessage(parsed)) {
            this.onProtocolError('WS payload was not an overlay message', parsed);
            return;
        }
        for (const listener of this.listeners) {
            listener(parsed);
        }
    }
}

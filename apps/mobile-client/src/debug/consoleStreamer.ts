/**
 * Console streamer — subscribes to the {@link consoleRelay} singleton and
 * forwards each captured entry to the editor via the relay WebSocket client
 * (MC3.13) as an `onlook:console` wire message.
 *
 * If the client is not currently connected (or `send` throws because the
 * socket closed between the `isConnected` check and the write), entries are
 * buffered locally and flushed on the next {@link ConsoleStreamer.start} call.
 *
 * Task: MC5.2
 * Deps: MC5.1, MC3.13
 */

import type { WsSenderHandle } from '../relay/wsSender';
import { consoleRelay, type ConsoleEntry } from './consoleRelay';

/**
 * Forwards entries from the console relay to the editor over the relay
 * WebSocket. Constructed with a sender handle and a session id; call
 * {@link start} to begin forwarding and {@link stop} to unsubscribe.
 *
 * The `client` parameter is structurally typed as {@link WsSenderHandle}
 * (`isConnected` getter + `send(msg)` method) so production callers can
 * pass `dynamicWsSender` from `../relay/wsSender` — which delegates to
 * AppRouter's Spike B WS via the global registry — without
 * instantiating the canonical `OnlookRelayClient` (dead-on-arrival in
 * production). Tests pass a small fake satisfying the same shape.
 */
export class ConsoleStreamer {
    private unsubscribe: (() => void) | null = null;
    private buffer: ConsoleEntry[] = [];

    constructor(
        private readonly client: WsSenderHandle,
        private sessionId: string,
    ) {}

    /**
     * Update the session id stamped on outgoing `onlook:console` messages.
     * Production wiring boots ConsoleStreamer with a placeholder
     * sessionId before the deeplink flow resolves; this updates it once
     * the real id is known.
     */
    setSessionId(sessionId: string): void {
        this.sessionId = sessionId;
    }

    /**
     * Subscribe to the console relay and flush any entries buffered while
     * the streamer was stopped or the socket was down. Safe to call multiple
     * times — subsequent calls are no-ops until `stop()` runs.
     */
    start(): void {
        if (this.unsubscribe) return;
        this.unsubscribe = consoleRelay.onEntry((entry) => this.forward(entry));
        // Flush buffer accumulated while disconnected.
        const queued = this.buffer.splice(0);
        queued.forEach((e) => this.forward(e));
    }

    /**
     * Unsubscribe from the console relay. Any entries already buffered are
     * retained and will flush on the next `start()`.
     */
    stop(): void {
        this.unsubscribe?.();
        this.unsubscribe = null;
    }

    /**
     * Send an entry immediately when connected, otherwise buffer it for the
     * next flush. A thrown `send` (socket closed mid-write) also falls back
     * to buffering so the entry is not lost.
     */
    private forward(entry: ConsoleEntry): void {
        if (!this.client.isConnected) {
            this.buffer.push(entry);
            return;
        }
        try {
            const parsed = Date.parse(entry.timestamp);
            const timestamp = Number.isFinite(parsed) ? parsed : Date.now();
            this.client.send({
                type: 'onlook:console',
                sessionId: this.sessionId,
                level: entry.level,
                args: [entry.message],
                timestamp,
            });
        } catch {
            this.buffer.push(entry);
        }
    }
}

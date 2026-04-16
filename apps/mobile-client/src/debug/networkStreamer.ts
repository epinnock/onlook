/**
 * Network streamer — combines entries from the fetch patch (MC5.3) and the
 * XHR patch (MC5.4) and forwards each completed request to the editor via
 * the relay WebSocket client (MC3.13).
 *
 * Wire format: each forwarded message conforms to `NetworkMessageSchema`
 * from `@onlook/mobile-client-protocol` (`type: 'onlook:network'`).
 * `NetworkEntry` (from the patch sources) is mapped to `NetworkMessage` per
 * field; the patches only emit terminal entries so `phase` is always `'end'`
 * on success or `'error'` if the entry carries an error.
 *
 * If the client is not currently connected (or `send` throws), entries are
 * buffered locally and flushed on the next `start()` call.
 *
 * Task: MC5.5
 * Deps: MC5.3, MC5.4, MC3.13
 */

import type { NetworkMessage } from '@onlook/mobile-client-protocol';
import type { OnlookRelayClient } from '../relay/wsClient';
import { FetchPatch, fetchPatch, type NetworkEntry } from './fetchPatch';
import { XhrPatch, xhrPatch } from './xhrPatch';

/** Maximum number of messages held in the disconnect buffer before dropping. */
const MAX_BUFFER_SIZE = 200;

/** Constructor options. */
export interface NetworkStreamerSources {
    fetchPatch?: FetchPatch;
    xhrPatch?: XhrPatch;
}

/** Additional configuration for the streamer. */
export interface NetworkStreamerOptions {
    /**
     * Session id included on each outgoing `NetworkMessage`. Can be updated
     * later via {@link NetworkStreamer.setSessionId}.
     *
     * Defaults to `'unknown'` so the streamer is safe to construct before a
     * session has been negotiated. Consumers should call `setSessionId`
     * before `start()` once the real id is known.
     */
    sessionId?: string;
}

/**
 * Map a `NetworkEntry` produced by the fetch/XHR patches to the wire-level
 * `NetworkMessage` shape defined by the protocol package.
 */
function toMessage(entry: NetworkEntry, sessionId: string): NetworkMessage {
    const ts = entry.endTime ?? entry.startTime;
    const parsed = Date.parse(ts);
    const timestamp = Number.isFinite(parsed) ? parsed : Date.now();

    const msg: NetworkMessage = {
        type: 'onlook:network',
        sessionId,
        requestId: entry.id,
        method: entry.method,
        url: entry.url,
        phase: entry.error ? 'error' : 'end',
        timestamp,
    };
    if (entry.status !== null) {
        msg.status = entry.status;
    }
    if (entry.duration !== null) {
        msg.durationMs = entry.duration;
    }
    return msg;
}

/**
 * Forwards completed fetch/XHR entries from one or both network patches to
 * the relay via an {@link OnlookRelayClient}.
 *
 * Subscribes to `onEntry` on each source in `start()` and unsubscribes in
 * `stop()`. When the client is disconnected at the moment of emission, the
 * resulting wire message is queued locally (up to {@link MAX_BUFFER_SIZE}
 * entries) and flushed on the next `start()` call.
 */
export class NetworkStreamer {
    private readonly _client: OnlookRelayClient;
    private readonly _fetchSource: FetchPatch;
    private readonly _xhrSource: XhrPatch;

    private _sessionId: string;
    private _running = false;
    private _unsubFetch: (() => void) | null = null;
    private _unsubXhr: (() => void) | null = null;

    /** Messages queued while the client was not connected. */
    private _pending: NetworkMessage[] = [];

    constructor(
        client: OnlookRelayClient,
        sources: NetworkStreamerSources = {},
        options: NetworkStreamerOptions = {},
    ) {
        this._client = client;
        this._fetchSource = sources.fetchPatch ?? fetchPatch;
        this._xhrSource = sources.xhrPatch ?? xhrPatch;
        this._sessionId = options.sessionId ?? 'unknown';
    }

    /**
     * Update the session id stamped on outgoing messages.
     *
     * Typically called once after the deep-link / launch flow has resolved
     * the session.
     */
    setSessionId(sessionId: string): void {
        this._sessionId = sessionId;
    }

    /** Whether the streamer is currently subscribed to its sources. */
    get isRunning(): boolean {
        return this._running;
    }

    /** Number of messages currently buffered waiting for a live connection. */
    get pendingCount(): number {
        return this._pending.length;
    }

    /**
     * Subscribe to both sources, flush any locally-buffered messages, and
     * begin forwarding new entries to the relay.
     *
     * Safe to call multiple times — subsequent calls are no-ops until
     * `stop()` runs.
     */
    start(): void {
        if (this._running) return;
        this._running = true;

        // Flush any messages that piled up while disconnected. Do this
        // before subscribing so the flush does not race with brand-new
        // entries landing on the same tick.
        this._flush();

        this._unsubFetch = this._fetchSource.onEntry((entry) => {
            this._handle(entry);
        });
        this._unsubXhr = this._xhrSource.onEntry((entry) => {
            this._handle(entry);
        });
    }

    /**
     * Unsubscribe from both sources. Any in-flight buffered messages are
     * kept and will flush on the next `start()` call.
     */
    stop(): void {
        if (!this._running) return;
        this._running = false;

        if (this._unsubFetch) {
            this._unsubFetch();
            this._unsubFetch = null;
        }
        if (this._unsubXhr) {
            this._unsubXhr();
            this._unsubXhr = null;
        }
    }

    /** Drop every queued message without flushing. Test / teardown helper. */
    clearBuffer(): void {
        this._pending.length = 0;
    }

    // ── private ──────────────────────────────────────────────────────────

    /**
     * Translate a `NetworkEntry` to a `NetworkMessage` and either send it
     * immediately (if the client is connected) or queue it.
     */
    private _handle(entry: NetworkEntry): void {
        const msg = toMessage(entry, this._sessionId);
        if (this._client.isConnected) {
            try {
                this._client.send(msg);
                return;
            } catch {
                // `send` throws when the socket closes between the
                // `isConnected` check and the write. Fall through to
                // buffering so the message is not lost.
            }
        }
        this._enqueue(msg);
    }

    /** Push a message to the pending buffer, dropping the oldest on overflow. */
    private _enqueue(msg: NetworkMessage): void {
        this._pending.push(msg);
        if (this._pending.length > MAX_BUFFER_SIZE) {
            this._pending.splice(0, this._pending.length - MAX_BUFFER_SIZE);
        }
    }

    /**
     * Drain the pending buffer to the client. If the socket is not open, or
     * a send throws mid-drain, the remaining messages stay buffered.
     */
    private _flush(): void {
        if (this._pending.length === 0) return;
        if (!this._client.isConnected) return;

        // Splice to a local queue so re-entry (a send that somehow triggers
        // another entry synchronously) cannot see a half-drained buffer.
        const queue = this._pending;
        this._pending = [];

        for (let i = 0; i < queue.length; i++) {
            const msg = queue[i]!;
            try {
                this._client.send(msg);
            } catch {
                // Connection dropped mid-flush. Re-queue this message and
                // everything after it, preserving order.
                this._pending = queue.slice(i).concat(this._pending);
                return;
            }
        }
    }
}

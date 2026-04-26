/**
 * Exception streamer — subscribes to {@link exceptionCatcher} (MC5.7)
 * and forwards each captured exception to the editor via the relay
 * WebSocket as an `onlook:error` wire message.
 *
 * Pairs with `ConsoleStreamer` and `wsSender.ts` to close the
 * mobile-client observability gap. ExceptionCatcher itself only
 * patches the global error hooks and buffers entries — without this
 * streamer, the editor's source-map decoration receive-chain
 * (`wireBufferDecorationOnError` in use-mobile-preview-status.tsx)
 * has no producer.
 *
 * Wire format: each forwarded message conforms to `ErrorMessageSchema`
 * from `@onlook/mobile-client-protocol` (`type: 'onlook:error'`):
 *   { type, sessionId, kind: 'js'|'react'|'native', message, stack?,
 *     source?, timestamp }
 *
 * Buffering: if the underlying sender is not connected (or `send`
 * throws), entries queue locally and flush on the next captured
 * exception once the WS reopens. Capped at 50 entries (matches
 * ExceptionCatcher's own ring-buffer cap) so an extended outage
 * doesn't unboundedly grow memory; oldest entries are dropped first.
 *
 * Task: MC5.7 wiring follow-up.
 * Deps: MC5.7 (ExceptionCatcher), MC3.13 (WS relay).
 */

import type { ErrorMessage } from '@onlook/mobile-client-protocol';

import type { WsSenderHandle } from '../relay/wsSender';
import {
    exceptionCatcher,
    type ExceptionCatcher,
    type ExceptionEntry,
} from './exceptionCatcher';

const MAX_BUFFER_SIZE = 50;

/**
 * Map an {@link ExceptionEntry} to the wire-level `ErrorMessage`
 * shape. The schema's `kind` enum allows `'js' | 'react' | 'native'`;
 * we forward `'js'` and `'native'` straight through. ErrorBoundary
 * captures (which carry `componentStack`) come in as `kind: 'js'` from
 * `captureException` but should be reported as `'react'` so the editor
 * can route them to the React-error UI. We disambiguate via the
 * presence of `componentStack`.
 */
function toMessage(entry: ExceptionEntry, sessionId: string): ErrorMessage {
    const wireKind: ErrorMessage['kind'] =
        entry.kind === 'native'
            ? 'native'
            : entry.componentStack !== null
                ? 'react'
                : 'js';
    const parsed = Date.parse(entry.timestamp);
    const timestamp = Number.isFinite(parsed) ? parsed : Date.now();
    const out: ErrorMessage = {
        type: 'onlook:error',
        sessionId,
        kind: wireKind,
        message: entry.message,
        timestamp,
    };
    if (entry.stack !== null) {
        return { ...out, stack: entry.stack };
    }
    return out;
}

export interface ExceptionStreamerSources {
    /** Catcher to subscribe to. Defaults to the module-level singleton. */
    catcher?: ExceptionCatcher;
}

/**
 * Forwards entries from the exception catcher to the editor over the
 * relay WS. Constructed with a sender handle and a session id; call
 * {@link start} to subscribe and {@link stop} to unsubscribe. Hold a
 * reference to a stable `WsSenderHandle` (typically `dynamicWsSender`)
 * so socket reconnects are transparent.
 */
export class ExceptionStreamer {
    private unsubscribe: (() => void) | null = null;
    private buffer: ExceptionEntry[] = [];
    private readonly catcher: ExceptionCatcher;

    constructor(
        private readonly client: WsSenderHandle,
        private sessionId: string,
        sources: ExceptionStreamerSources = {},
    ) {
        this.catcher = sources.catcher ?? exceptionCatcher;
    }

    /**
     * Update the session id stamped on outgoing `onlook:error` messages.
     * Production wiring boots ExceptionStreamer with a placeholder
     * sessionId before the deeplink flow resolves.
     */
    setSessionId(sessionId: string): void {
        this.sessionId = sessionId;
    }

    /**
     * Subscribe to the exception catcher. `install()` on the catcher is
     * the caller's responsibility — typically called once at app boot
     * before the streamer starts. Safe to call multiple times; subsequent
     * calls are no-ops until `stop()` runs.
     */
    start(): void {
        if (this.unsubscribe) return;
        this.unsubscribe = this.catcher.onException((entry) => this.forward(entry));
        // Flush buffer accumulated while disconnected.
        const queued = this.buffer.splice(0);
        for (const e of queued) this.forward(e);
    }

    /**
     * Unsubscribe from the catcher. Buffered entries are retained and
     * flush on the next `start()`.
     */
    stop(): void {
        this.unsubscribe?.();
        this.unsubscribe = null;
    }

    private forward(entry: ExceptionEntry): void {
        if (!this.client.isConnected) {
            this.pushBuffer(entry);
            return;
        }
        try {
            this.client.send(toMessage(entry, this.sessionId));
        } catch {
            this.pushBuffer(entry);
            return;
        }
        // After the new entry sends successfully, opportunistically drain
        // any entries buffered during a prior disconnect or throw. Order:
        // current entry first, then the queued backlog in arrival order —
        // matches the "reconnect after outage" UX the tests pin.
        if (this.buffer.length === 0) return;
        const queued = this.buffer.splice(0);
        for (let i = 0; i < queued.length; i += 1) {
            const e = queued[i]!;
            try {
                this.client.send(toMessage(e, this.sessionId));
            } catch {
                // Re-buffer this entry plus any remaining queued items so
                // the next reconnect attempts them again. Earlier
                // successful entries stay drained.
                this.pushBuffer(e);
                for (let j = i + 1; j < queued.length; j += 1) {
                    this.pushBuffer(queued[j]!);
                }
                return;
            }
        }
    }

    private pushBuffer(entry: ExceptionEntry): void {
        if (this.buffer.length >= MAX_BUFFER_SIZE) {
            this.buffer.shift();
        }
        this.buffer.push(entry);
    }
}

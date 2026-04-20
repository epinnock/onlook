/**
 * Live reload dispatcher — filters `bundleUpdate` messages from the WebSocket
 * relay client and forwards the bundle URL to registered listeners.
 *
 * The dispatcher does NOT call `OnlookRuntime.reloadBundle` directly (that is a
 * native JSI call wired at the app level by MC3.21). Instead it exposes the new
 * bundle URL to listeners via `onReload`, and the app-level wiring connects
 * those listeners to the runtime call.
 *
 * Task: MC3.14
 */

import type { OnlookRelayClient } from './wsClient';
import type { WsMessage } from '@onlook/mobile-client-protocol';

/**
 * Dispatches `bundleUpdate` WebSocket messages to reload handlers.
 *
 * Usage:
 * ```ts
 * const dispatcher = new LiveReloadDispatcher(relayClient);
 * dispatcher.onReload((bundleUrl) => {
 *     OnlookRuntime.reloadBundle(bundleUrl);
 * });
 * dispatcher.start();
 * ```
 */
export class LiveReloadDispatcher {
    private readonly client: OnlookRelayClient;
    private readonly reloadListeners = new Set<(bundleUrl: string) => void>();
    private unsubscribeWs: (() => void) | null = null;

    constructor(client: OnlookRelayClient) {
        this.client = client;
    }

    /**
     * Subscribe to the WS client's messages and begin dispatching
     * `bundleUpdate` events to reload listeners.
     *
     * Safe to call multiple times — duplicate calls are no-ops.
     */
    start(): void {
        if (this.unsubscribeWs) {
            return;
        }

        this.unsubscribeWs = this.client.onMessage((msg: WsMessage) => {
            if (msg.type !== 'bundleUpdate') {
                return;
            }
            const bundleUrl = msg.bundleUrl;
            for (const listener of this.reloadListeners) {
                listener(bundleUrl);
            }
        });
    }

    /**
     * Unsubscribe from the WS client's messages. Reload listeners are retained
     * so that a subsequent `start()` will resume dispatching to them.
     */
    stop(): void {
        if (this.unsubscribeWs) {
            this.unsubscribeWs();
            this.unsubscribeWs = null;
        }
    }

    /**
     * Register a handler that is called whenever a `bundleUpdate` message
     * arrives with the new bundle URL.
     *
     * @returns An unsubscribe function that removes this specific handler.
     */
    onReload(handler: (bundleUrl: string) => void): () => void {
        this.reloadListeners.add(handler);
        return () => {
            this.reloadListeners.delete(handler);
        };
    }
}

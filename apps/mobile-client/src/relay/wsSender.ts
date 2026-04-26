/**
 * Shared "send a message over the active relay WS" surface — decouples
 * observability streamers (ConsoleStreamer, future NetworkStreamer/
 * ExceptionStreamer) from `OnlookRelayClient`. The canonical class is
 * never instantiated in production; AppRouter's Spike B raw WS is the
 * actual production socket. This module bridges the two.
 *
 * The registry is a process-wide singleton because:
 *   - The phone has exactly one active relay session at a time.
 *   - Streamers patch GLOBAL state (console, fetch, errorUtils) so they
 *     must be installed once at app boot, not per-session.
 *   - WS lifetime is shorter than streamer lifetime: the streamer must
 *     keep accepting events when the WS is disconnected (buffering or
 *     dropping), and resume sending when it reopens.
 *
 * Wiring contract (production):
 *   1. App boot: `wireConsoleStreamer()` instantiates ConsoleStreamer
 *      with `dynamicWsSender` and calls `start()`. Console patches are
 *      installed; events queue locally because no sender is active yet.
 *   2. AppRouter opens its WS: calls `registerActiveWsSender(handle)`
 *      with an adapter that wraps the raw `WebSocket`. Streamers'
 *      `dynamicWsSender.isConnected` flips to `true`; their next
 *      `forward()` call drains the local buffer over the wire.
 *   3. AppRouter's WS closes: calls `unregisterActiveWsSender()`.
 *      Streamers' `dynamicWsSender.isConnected` reverts to `false`.
 *
 * Why a "dynamic" sender wrapper instead of passing the live handle to
 * the streamer at construction: the streamer is created once at app
 * boot but the underlying WS handle changes across reconnects. The
 * wrapper consults the registry on every `send` call so the streamer
 * never holds a stale reference.
 */
import type { WsMessage } from '@onlook/mobile-client-protocol';

export interface WsSenderHandle {
    /** True when the underlying socket is open and `send` will not throw. */
    readonly isConnected: boolean;
    /**
     * Serialize and send a single message over the relay WS. May throw
     * if the socket is closed mid-write — callers (typically streamers)
     * are expected to fall back to local buffering on throw.
     */
    send(msg: WsMessage): void;
}

let activeSender: WsSenderHandle | null = null;

/**
 * Register the live WS sender. Called by the production WS opener
 * (AppRouter's Spike B path) on every successful `onopen`. Replaces any
 * previously-registered sender — the most recent registration wins.
 */
export function registerActiveWsSender(handle: WsSenderHandle): void {
    activeSender = handle;
}

/**
 * Clear the registered sender. Called by the production WS opener on
 * every `onclose`/`onerror`. Idempotent — safe to call when no sender
 * is registered.
 */
export function unregisterActiveWsSender(): void {
    activeSender = null;
}

/**
 * Read the currently-registered sender, or `null` when no WS is open.
 * Tests use this to assert registration state. Production code should
 * prefer {@link dynamicWsSender}, which delegates lazily without the
 * caller having to handle null.
 */
export function getActiveWsSender(): WsSenderHandle | null {
    return activeSender;
}

/**
 * Stable `WsSenderHandle` whose `isConnected` and `send` always
 * delegate to whatever sender is currently registered. Pass this to
 * streamer constructors — the streamer holds one reference for its
 * lifetime, and the registry handles WS reconnects transparently.
 *
 * `send` throws when no sender is registered, which the streamers
 * catch and fall back to buffering. `isConnected` returns `false` in
 * that case so streamers buffer pre-emptively without going through
 * the throw path.
 */
export const dynamicWsSender: WsSenderHandle = {
    get isConnected(): boolean {
        return activeSender?.isConnected ?? false;
    },
    send(msg: WsMessage): void {
        if (activeSender === null) {
            throw new Error(
                'wsSender: no active sender registered (WS not open)',
            );
        }
        activeSender.send(msg);
    },
};

/**
 * Test-only helper. Forces the registry back to an empty state so each
 * test starts from a known baseline. Calling this in production is a
 * bug.
 */
export function __resetActiveWsSenderForTests(): void {
    activeSender = null;
}

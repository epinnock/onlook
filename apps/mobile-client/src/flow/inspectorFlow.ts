/**
 * End-to-end inspector flow for the Onlook mobile client.
 *
 * Bundles MC4.14 (JS-side `TapHandler`) with the editor-side MC4.15
 * (`onlookSelectReceiver`) into a single callable entry point. The mobile
 * side is the only half this module owns — native gesture capture
 * (MC4.2 / MC4.6, blocked on Wave 2 MC2.5) and the Monaco cursor jump
 * (MC4.17) live outside it.
 *
 * Pipeline at runtime:
 *
 *   1. Native gesture layer (or a wrapper React component) extracts
 *      `props.__source` off the tapped element with
 *      {@link extractSource} and invokes `tapHandler.handleTap(src)`.
 *   2. `TapHandler` stamps `sessionId` + `reactTag` onto the source and
 *      sends an `onlook:select` wire message via
 *      `OnlookRelayClient.send()` (MC3.13).
 *   3. The relay forwards the message to the paired editor session,
 *      where `dispatchOnlookSelect` (MC4.15) fans it out to the Monaco
 *      cursor-jump handler (MC4.17).
 *
 * The flow module is deliberately thin — it constructs the `TapHandler`,
 * wires the `sessionId` through, and hands back a cleanup routine so
 * the caller (a wrapper component or the root `App`) can detach when
 * the session changes. It does **not** touch the native code, subscribe
 * to the WS (the tap direction is client → relay only), or mount any UI.
 *
 * Task: MC4.18
 * Deps: MC4.14 (`TapHandler`), MC4.15 (editor receiver — exercised on
 *       the editor side; documented here for integration shape).
 */

import { TapHandler } from '../inspector/tapHandler';
import type { OnlookRelayClient } from '../relay/wsClient';

/**
 * Handle returned from {@link wireInspectorFlow}. Callers keep the
 * `tapHandler` for their native-gesture / wrapper-component binding and
 * invoke `destroy()` when the session ends (unmount, QR rescan, or
 * explicit logout) to prevent further `onlook:select` writes and clear
 * the internal session id.
 */
export interface InspectorFlowHandle {
    /** The `TapHandler` produced for this session. Callers hand it to
     *  the native gesture layer or wrap an `onPress` around it:
     *
     *    onPress={() => tapHandler.handleTap(extractSource(props))}
     */
    tapHandler: TapHandler;

    /**
     * Tear down the flow. After `destroy()`:
     *   - `handleTap()` becomes a no-op (no `onlook:select` writes).
     *   - The internal `sessionId` is blanked so a re-wire picks up
     *     the next session cleanly.
     *
     * Idempotent — calling twice is a no-op on the second call.
     */
    destroy: () => void;
}

/**
 * Wire the mobile-side half of the inspector flow.
 *
 * Constructs a single {@link TapHandler} bound to the supplied relay
 * WebSocket client and the current session id. Returns the handler plus
 * a `destroy()` cleanup callback. The handler is the only side-effectful
 * piece — register it with the native gesture layer (or a wrapper
 * component) and all subsequent taps will flow to the editor via the
 * relay.
 *
 * @example
 *   const { tapHandler, destroy } = wireInspectorFlow(client, sessionId);
 *   // inside a wrapper component:
 *   <View onPress={(e) => tapHandler.handleTap(extractSource(e.target.props))} />
 *   // on session teardown:
 *   destroy();
 *
 * @param client     The shared relay WebSocket client (MC3.13). Must be
 *                   constructed and `connect()`-ed elsewhere; this
 *                   module does not own the socket lifecycle.
 * @param sessionId  Session id the editor uses to correlate the tap.
 *                   Required — passing an empty string throws so
 *                   misconfigured callers fail loudly.
 */
export function wireInspectorFlow(
    client: OnlookRelayClient,
    sessionId: string,
): InspectorFlowHandle {
    if (typeof sessionId !== 'string' || sessionId.length === 0) {
        throw new Error(
            '[wireInspectorFlow] sessionId must be a non-empty string',
        );
    }

    const tapHandler = new TapHandler(client, { sessionId });

    // `destroyed` latches once `destroy()` has been called. We monkey-patch
    // `handleTap` instead of replacing the whole handler so references
    // already handed to the native gesture layer continue to work (the
    // caller holds onto the `TapHandler` instance, not a reference to the
    // method).
    let destroyed = false;
    const originalHandleTap = tapHandler.handleTap.bind(tapHandler);
    tapHandler.handleTap = (source) => {
        if (destroyed) return;
        originalHandleTap(source);
    };

    const destroy = (): void => {
        if (destroyed) return;
        destroyed = true;
        // Blank the session id so any residual reference (e.g. a dev
        // overlay that stashed the handler) can't accidentally leak a
        // stale id into a future session.
        tapHandler.setSessionId('');
    };

    return { tapHandler, destroy };
}

import type { RelayEvent } from '@onlook/mobile-preview';

import type { OverlayListener } from '../relay/overlayDispatcher';
import { OverlayDispatcher, resolveHmrSessionUrl } from '../relay/overlayDispatcher';
import {
    startOverlayAckPoll,
    type OverlayAckPollHandle,
} from '../relay/overlayAckPoll';
import { isTwoTierPipelineEnabled } from './featureFlags';

/**
 * Two-tier overlay bootstrap.
 *
 * Starts an OverlayDispatcher against `/hmr/:sessionId` when the two-tier
 * feature flag is enabled, and hands each received overlay to the existing
 * native `OnlookRuntime.reloadBundle(bundleSource)` JSI method (source plan
 * Phase 2 / MC2.8). When the flag is off this is a no-op and the legacy
 * single-bundle path is untouched.
 *
 * The overlay payload is emitted by `@onlook/browser-bundler`'s
 * `wrapOverlayCode` as a self-mounting bundle — it installs
 * `globalThis.onlookMount` during eval, and `reloadBundle` then calls it.
 * No JS-side shim in shell.js is required.
 */

declare global {
    var OnlookRuntime:
        | {
              reloadBundle?: (bundleSource: string) => void;
              version?: string | (() => string);
          }
        | undefined;
}

export interface TwoTierBootstrapOptions {
    readonly sessionId: string;
    readonly relayUrl: string;
    /** Feature-flag override for tests. Defaults to `isTwoTierPipelineEnabled()`. */
    readonly enabled?: boolean;
    /** Test override for the dispatcher factory. */
    readonly createDispatcher?: (url: string) => OverlayDispatcher;
    /**
     * Test override for the mount hook. Defaults to
     * `globalThis.OnlookRuntime.reloadBundle`. The overlay bundle is
     * self-mounting (see `wrapOverlayCode`) — `reloadBundle` tears down
     * the prior tree via `onlookUnmount` then eval's the new bundle,
     * which registers a fresh `onlookMount` and gets called immediately.
     */
    readonly mountOverlay?: (code: string) => void;
    /** Side-channel logger used for diagnostics. */
    readonly log?: (message: string) => void;
    /**
     * Test override for the overlay-ack poll starter. Defaults to
     * `startOverlayAckPoll` from `src/relay/overlayAckPoll`. When omitted
     * and `OnlookRuntime.httpGet` is installed, the bootstrap starts a
     * poll against the relay's `/events` endpoint to receive OverlayAck
     * and any other phone→editor event. MCG.10 step 4.
     */
    readonly startOverlayAckPoll?: typeof startOverlayAckPoll;
    /** Called for every relay event received via the ack-poll channel. */
    readonly onRelayEvent?: (event: RelayEvent) => void;
}

export interface TwoTierBootstrapHandle {
    /** Disposes the underlying dispatcher. Idempotent. */
    stop(): void;
    /** `true` when an OverlayDispatcher is actively connected. */
    readonly active: boolean;
}

const INACTIVE_HANDLE: TwoTierBootstrapHandle = {
    stop(): void {
        // no-op — nothing was started.
    },
    active: false,
};

/**
 * Kick off the two-tier overlay channel for the given session.
 *
 * Returns an inactive handle when the flag is off so callers can always
 * invoke `.stop()` in cleanup without a null check.
 */
export function startTwoTierBootstrap(options: TwoTierBootstrapOptions): TwoTierBootstrapHandle {
    const enabled = options.enabled ?? isTwoTierPipelineEnabled();
    const log = options.log ?? ((msg) => console.log('[two-tier]', msg));

    if (!enabled) {
        log(`disabled; sessionId=${options.sessionId}`);
        return INACTIVE_HANDLE;
    }

    const hmrUrl = resolveHmrSessionUrl(options.relayUrl, options.sessionId);
    log(`starting dispatcher for sessionId=${options.sessionId} url=${hmrUrl}`);

    const dispatcher = options.createDispatcher
        ? options.createDispatcher(hmrUrl)
        : new OverlayDispatcher(hmrUrl);

    // phone→editor ack. HmrSession's onMessage whitelists `onlook:overlayAck`
    // in ONLOOK_OBSERVABILITY_TYPES and fans it out to the editor's socket.
    // Bridgeless iOS 18.6's WS receive-side is dead (ADR finding #8); send-
    // side TCP write works, so this is the supported ack path from device.
    const sendAck = (msg: { code: string }, status: 'mounted' | 'failed', errorMessage?: string): void => {
        const overlayHash = `legacy-${msg.code.length}`;
        const ack: Record<string, unknown> = {
            type: 'onlook:overlayAck',
            sessionId: options.sessionId,
            overlayHash,
            status,
            timestamp: Date.now(),
        };
        if (errorMessage !== undefined) {
            ack.error = { kind: 'mount-threw', message: errorMessage };
        }
        const sent = dispatcher.send(ack);
        log(`overlayAck ${status} sent=${sent} hash=${overlayHash}`);
    };

    const mount: OverlayListener = (msg) => {
        const explicit = options.mountOverlay;
        if (typeof explicit === 'function') {
            try {
                explicit(msg.code);
                sendAck(msg, 'mounted');
            } catch (err) {
                const message = err instanceof Error ? err.message : String(err);
                log(`mount threw: ${message}`);
                sendAck(msg, 'failed', message);
            }
            return;
        }
        const reloadBundle = globalThis.OnlookRuntime?.reloadBundle;
        if (typeof reloadBundle === 'function') {
            try {
                reloadBundle(msg.code);
                sendAck(msg, 'mounted');
            } catch (err) {
                const message = err instanceof Error ? err.message : String(err);
                log(`reloadBundle threw: ${message}`);
                sendAck(msg, 'failed', message);
            }
            return;
        }
        log(
            `overlay received but OnlookRuntime.reloadBundle is not available ` +
                `(${msg.code.length} bytes of bundle) — runtime not booted yet`,
        );
    };

    const unsubscribe = dispatcher.onOverlay(mount);
    dispatcher.start();

    // Start the overlay-ack poll channel. Gracefully returns an
    // `installed:false` handle if `OnlookRuntime.httpGet` isn't available
    // (Spike-B / harness contexts), so nothing below needs to branch.
    const pollStarter = options.startOverlayAckPoll ?? startOverlayAckPoll;
    let ackPollHandle: OverlayAckPollHandle | undefined;
    try {
        ackPollHandle = pollStarter({
            relayHost: options.relayUrl,
            sessionId: options.sessionId,
            onEvent: (event) => {
                try {
                    options.onRelayEvent?.(event);
                } catch (err) {
                    log(
                        `onRelayEvent threw: ${err instanceof Error ? err.message : String(err)}`,
                    );
                }
            },
            onError: (err) => {
                log(`overlayAckPoll error: ${err.message}`);
            },
        });
        if (ackPollHandle.installed) {
            log(`overlayAckPoll started sessionId=${options.sessionId}`);
        }
    } catch (err) {
        log(
            `overlayAckPoll start threw: ${err instanceof Error ? err.message : String(err)}`,
        );
    }

    let stopped = false;
    return {
        stop(): void {
            if (stopped) return;
            stopped = true;
            unsubscribe();
            dispatcher.stop();
            try {
                ackPollHandle?.stop();
            } catch (err) {
                log(
                    `overlayAckPoll stop threw: ${err instanceof Error ? err.message : String(err)}`,
                );
            }
            log(`stopped sessionId=${options.sessionId}`);
        },
        get active(): boolean {
            return !stopped;
        },
    };
}

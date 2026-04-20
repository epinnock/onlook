import type { OverlayListener } from '../relay/overlayDispatcher';
import { OverlayDispatcher, resolveHmrSessionUrl } from '../relay/overlayDispatcher';
import { isTwoTierPipelineEnabled } from './featureFlags';

/**
 * Two-tier overlay bootstrap.
 *
 * Starts an OverlayDispatcher against `/hmr/:sessionId` when the two-tier
 * feature flag is enabled, and routes incoming overlays to the native
 * `__onlookMountOverlay` JSI binding. When the flag is off this is a no-op
 * and the legacy single-bundle path remains unchanged.
 *
 * The OnlookRuntime native mount (`globalThis.__onlookMountOverlay`) is
 * currently being implemented behind the Xcode 16.1 device-build blocker
 * (see plans/onlook-mobile-client-plan.md). Until that lands, the overlay
 * is received and logged; nothing mounts. That is intentional — the TS
 * side must ship first so the native wiring has an observable target.
 */

declare global {
    var __onlookMountOverlay: ((code: string) => void) | undefined;
}

export interface TwoTierBootstrapOptions {
    readonly sessionId: string;
    readonly relayUrl: string;
    /** Feature-flag override for tests. Defaults to `isTwoTierPipelineEnabled()`. */
    readonly enabled?: boolean;
    /** Test override for the dispatcher factory. */
    readonly createDispatcher?: (url: string) => OverlayDispatcher;
    /** Test override for the native mount hook. Defaults to `globalThis.__onlookMountOverlay`. */
    readonly mountOverlay?: (code: string) => void;
    /** Side-channel logger used for diagnostics. */
    readonly log?: (message: string) => void;
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

    const mount: OverlayListener = (msg) => {
        const mountFn = options.mountOverlay ?? globalThis.__onlookMountOverlay;
        if (typeof mountFn === 'function') {
            try {
                mountFn(msg.code);
            } catch (err) {
                log(`mount threw: ${err instanceof Error ? err.message : String(err)}`);
            }
            return;
        }
        log(
            `overlay received but __onlookMountOverlay is not installed yet ` +
                `(${msg.code.length} bytes of CJS) — JSI mount is Phase F work`,
        );
    };

    const unsubscribe = dispatcher.onOverlay(mount);
    dispatcher.start();

    let stopped = false;
    return {
        stop(): void {
            if (stopped) return;
            stopped = true;
            unsubscribe();
            dispatcher.stop();
            log(`stopped sessionId=${options.sessionId}`);
        },
        get active(): boolean {
            return !stopped;
        },
    };
}

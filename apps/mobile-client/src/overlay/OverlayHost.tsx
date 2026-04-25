import React, { useCallback, useEffect, useState } from 'react';
import { View } from 'react-native';

import type { OverlayGlobals } from './overlayHostSubscription';
import { OverlayErrorBoundary } from './OverlayErrorBoundary';
import {
    OVERLAY_FRAME_POINTER_EVENTS,
    OVERLAY_FRAME_STYLE,
    subscribeOverlayPull,
} from './overlayHostSubscription';

export type { OverlayGlobals };
export { OVERLAY_FRAME_POINTER_EVENTS, OVERLAY_FRAME_STYLE, subscribeOverlayPull };

/**
 * Route React error-boundary catches through `OnlookRuntime.reportError` when
 * the runtime is installed. Closes the observability gap where an overlay
 * that MOUNTED successfully but later crashed in a React lifecycle would
 * leave the phone silent — the editor's ack tracker would see 'mounted' and
 * never transition to 'error'.
 *
 * Exported for testing; the default OverlayHost wires it as the error
 * boundary's onError handler.
 */
export function reportOverlayBoundaryError(error: Error): void {
    const rt = (globalThis as {
        OnlookRuntime?: {
            reportError?: (err: {
                kind: string;
                message: string;
                stack?: string;
            }) => void;
        };
    }).OnlookRuntime;
    if (rt && typeof rt.reportError === 'function') {
        try {
            rt.reportError({
                kind: 'overlay-react',
                message: error.message,
                stack: error.stack,
            });
        } catch {
            // reportError sinks must not take down the host app; swallow.
        }
    }
}

/**
 * OverlayHost — single React surface the two-tier v2 mount pipeline uses to
 * render the latest overlay element.
 *
 * `apps/mobile-client/index.js`'s subscribable `renderApp` pushes the element
 * via `globalThis._onlookOverlayElement` and notifies subscribers via
 * `globalThis._onlookOverlaySubscribers`; `OverlayHost` is one such subscriber.
 * It lives inside `App.tsx`'s root fragment as a sibling of `<AppRouter />`
 * rather than being driven by `AppRegistry.runApplication('OnlookOverlay',
 * {rootTag: 1})` because the latter silently no-ops in bridgeless+new-arch
 * (ADR finding #6) and the old-arch fallback relies on `UIManager.createView`
 * which is absent in new-arch (ADR finding #5).
 *
 * Extracted from inline in `App.tsx` so it is unit-testable. The behavioural
 * contract is identical to the previous inline version.
 */

export function OverlayHost(): React.ReactElement | null {
    const [element, setElement] = useState<React.ReactNode>(null);
    useEffect(() => {
        const gt = globalThis as unknown as OverlayGlobals;
        return subscribeOverlayPull(gt, () => {
            setElement(gt._onlookOverlayElement ?? null);
        });
    }, []);
    const onBoundaryError = useCallback(reportOverlayBoundaryError, []);
    if (element === null || element === undefined) return null;
    return (
        <View
            pointerEvents={OVERLAY_FRAME_POINTER_EVENTS}
            style={OVERLAY_FRAME_STYLE}
        >
            <OverlayErrorBoundary onError={onBoundaryError}>
                {element as React.ReactElement}
            </OverlayErrorBoundary>
        </View>
    );
}

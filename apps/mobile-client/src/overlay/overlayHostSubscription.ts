import type React from 'react';

/**
 * Shape of the globalThis fields OverlayHost reads / mutates. Extracted as
 * a free-standing module (no `react-native` import) so that bun:test can
 * exercise the subscribe / unsubscribe / initial-pull contract without
 * touching the react-native barrel (which throws outside of an RN context).
 */
export type OverlayGlobals = {
    _onlookOverlaySubscribers?: Set<() => void>;
    _onlookOverlayElement?: React.ReactNode;
};

/**
 * Register a pull callback with the global subscriber Set, invoke it once
 * synchronously (so the first render reflects whatever element is already on
 * `_onlookOverlayElement`), and return a cleanup that removes the subscriber.
 *
 * Mirrors exactly what `OverlayHost`'s `useEffect` does — extracted so the
 * subscription contract is testable without a React renderer.
 */
export function subscribeOverlayPull(gt: OverlayGlobals, pull: () => void): () => void {
    pull();
    gt._onlookOverlaySubscribers ??= new Set();
    gt._onlookOverlaySubscribers.add(pull);
    return () => {
        gt._onlookOverlaySubscribers?.delete(pull);
    };
}

/**
 * Frame contract — the View wrapper that lets the overlay coexist as a
 * sibling of `<AppRouter />` inside `App.tsx`'s root fragment:
 *
 *   - `pointerEvents: "box-none"` means the wrapper itself never catches
 *     touches; children (the overlay content) can still receive them while
 *     any empty space falls through to the AppRouter screens behind.
 *   - Absolute positioning pinned to all four edges means the overlay fills
 *     the whole surface without pushing AppRouter content around.
 *
 * Exported as constants so bun:test can lock in the values without a
 * React renderer. OverlayHost.tsx consumes them directly.
 */
export const OVERLAY_FRAME_POINTER_EVENTS = 'box-none' as const;

export const OVERLAY_FRAME_STYLE = {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
} as const;

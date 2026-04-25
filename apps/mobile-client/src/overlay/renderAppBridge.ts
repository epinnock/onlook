/**
 * Installs the subscribable `renderApp` bridge on the supplied global object.
 *
 * Two-tier v2's overlay pipeline (`OnlookRuntime.mountOverlay`) `eval`s the
 * overlay bundle inside the mobile-client's Hermes runtime. That bundle calls
 * `globalThis.renderApp(element)` — our job is to accept the element, drop it
 * on a well-known slot, and notify anyone waiting to re-render (i.e.
 * `OverlayHost` in `App.tsx`).
 *
 * Pinning (`Object.defineProperty` with `writable:false, configurable:false`)
 * hardens against `packages/mobile-preview/runtime/runtime.js` clobbering the
 * bridge if it ever slips past the `__noOnlookRuntime` gate (ADR finding #3).
 * The filter stops bootloader trees that reference raw native component
 * strings from reaching `OverlayHost` (ADR finding #4).
 *
 * Factoring the setup into a plain function makes it exercisable from
 * bun:test — see `__tests__/renderAppBridge.test.ts`. `index.js` is still the
 * only production caller because Expo's `registerRootComponent` runs before
 * the bundler can transpile TypeScript.
 */

import { containsBadComponent } from './badComponentFilter';

type RenderAppFn = (element: unknown) => void;

export type RenderAppGlobals = {
    _onlookOverlaySubscribers?: Set<() => void>;
    _onlookOverlayElement?: unknown;
    renderApp?: RenderAppFn;
};

export type InstallResult = {
    renderApp: RenderAppFn;
    pinned: boolean;
};

export function installRenderAppBridge(gt: RenderAppGlobals): InstallResult {
    gt._onlookOverlaySubscribers ??= new Set();
    const subscribers = gt._onlookOverlaySubscribers;

    const renderApp: RenderAppFn = (element) => {
        if (containsBadComponent(element)) return;
        gt._onlookOverlayElement = element;
        subscribers.forEach((fn) => {
            try {
                fn();
            } catch {
                // Swallow subscriber errors — one broken subscriber must
                // not prevent the others from receiving the update.
            }
        });
    };

    let pinned = false;
    try {
        Object.defineProperty(gt, 'renderApp', {
            value: renderApp,
            writable: false,
            configurable: false,
            enumerable: true,
        });
        pinned = true;
    } catch {
        try {
            gt.renderApp = renderApp;
        } catch {
            // Global is sealed AND defineProperty rejected — the installed
            // renderApp is still available via the returned `result.renderApp`.
        }
    }

    return { renderApp, pinned };
}

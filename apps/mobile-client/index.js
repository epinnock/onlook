// Expo entry point for @onlook/mobile-client.
//
// Phase F task MCF8 of plans/onlook-mobile-client-task-queue.md.
// Must be plain JavaScript because Expo's `registerRootComponent` runs before
// the bundler sees any TypeScript. The real root component is src/App.tsx.
//
// `registerRootComponent` calls `AppRegistry.registerComponent('main', () => App)`
// and also installs the global error handler — this is the path every Expo
// managed app uses, and matches what the OnlookRuntime JSI binding will
// replace in Wave 2 once `runApplication(bundleSource, props)` is the primary
// mount path.

// Tell onlook-runtime.js (packages/mobile-preview/runtime/entry.js) to skip
// its React + reconciler setup. In bridgeless + new-arch, runtime.js's Fabric
// host-config calls UIManager.createView which doesn't exist — it triggers a
// "'createView' is not available in the new React Native architecture" RedBox
// on every mount. See plans/adr/v2-pipeline-validation-findings.md finding #5.
globalThis.__noOnlookRuntime = true;

import React from 'react';
import * as ReactNative from 'react-native';
import { TurboModuleRegistry } from 'react-native';
import { registerRootComponent } from 'expo';

import App from './src/App';

// Expose React + React Native to the overlay-bundle contract so
// `packages/browser-bundler/src/wrap-overlay.ts`'s emitted bundles can
// resolve `globalThis.React` AND `globalThis.__require('react-native')`.
// The mobile-client's entry.js intentionally skips `runtime.js`'s React
// setup (would cause dual-React hooks conflicts) — this bridge is the
// mobile-client equivalent: reuse main.jsbundle's own React for the
// overlay wrap's contract. See onlook/walkthrough fire-24 investigation.
try {
    const gt = globalThis;
    gt.React = React;
    // Also expose ReactNative on globalThis so eval'd overlay bundles can
    // resolve `RN.View` / `RN.Text`. Using raw component strings like
    // `'RCTRawText'` requires Fabric host-config (runtime.js) which we
    // intentionally don't load — ADR finding #4.
    gt.ReactNative = ReactNative;
    gt.__require = function overlayRequire(specifier) {
        if (specifier === 'react') return React;
        if (specifier === 'react-native') return ReactNative;
        throw new Error('overlay require: unsupported specifier "' + specifier + '"');
    };

    // Subscribable renderApp: apps/mobile-client/src/App.tsx mounts a single
    // `<OverlayHost />` that subscribes via `gt._onlookOverlaySubscribers` and
    // re-renders whenever `_onlookOverlayElement` changes. ADR findings #6 +
    // #7 for why this replaces the previous AppRegistry.runApplication loop.
    gt._onlookOverlaySubscribers = gt._onlookOverlaySubscribers || new Set();
    const _onlookOverlaySubscribers = gt._onlookOverlaySubscribers;
    // Filter out shell.js's bootloader tree (uses `RCTRawText` strings which
    // throw without runtime.js's host-config). ADR finding #4.
    const BAD_COMPONENTS = new Set(['RCTRawText', 'RCTText', 'RCTView']);
    const containsBadComponent = (el) => {
        if (!el || typeof el !== 'object') return false;
        if (typeof el.type === 'string' && BAD_COMPONENTS.has(el.type)) return true;
        const children = el.props && el.props.children;
        if (!children) return false;
        if (Array.isArray(children)) {
            for (let i = 0; i < children.length; i++) {
                if (containsBadComponent(children[i])) return true;
            }
            return false;
        }
        return containsBadComponent(children);
    };
    const _onlookRenderApp = function renderApp(element) {
        if (containsBadComponent(element)) return;
        gt._onlookOverlayElement = element;
        _onlookOverlaySubscribers.forEach(function (fn) {
            try { fn(); } catch (_) {}
        });
    };
    // Pin via defineProperty so runtime.js (loaded by the mobile-preview
    // harness path but NOT on mobile-client) cannot clobber the pinning
    // even if somehow loaded. ADR finding #3.
    try {
        Object.defineProperty(gt, 'renderApp', {
            value: _onlookRenderApp,
            writable: false,
            configurable: false,
            enumerable: true,
        });
    } catch (_) {
        gt.renderApp = _onlookRenderApp;
    }
} catch (err) {
    const msg = err && err.message ? err.message : String(err);
    if (typeof globalThis.__onlookDirectLog === 'function') {
        globalThis.__onlookDirectLog('[entry] React/renderApp bridge failed: ' + msg, 2);
    }
}

// Trigger the native OnlookRuntimeInstaller TurboModule's install() before
// the React tree mounts so its cpp-side work lands exactly once: it installs
// globalThis.OnlookRuntime (JSI host object) AND — task #73 — back-fills
// globalThis.nativeLoggingHook so every subsequent JS `slog()` / `console.*`
// call routes to os_log (iOS) / logcat (Android). Without this call the
// TurboModule is registered but its install method is never invoked, and
// both features silently no-op. See cpp/OnlookRuntimeInstaller.cpp.
try {
    const installer = TurboModuleRegistry.get('OnlookRuntimeInstaller');
    installer?.install?.();
} catch (err) {
    // Best-effort: don't brick app launch. Surface via whatever logging
    // path happens to be wired already.
    const msg = err && err.message ? err.message : String(err);
    const gt = globalThis;
    if (typeof gt.nativeLoggingHook === 'function') {
        gt.nativeLoggingHook('[OnlookMobileClient] installer.install failed: ' + msg, 2);
    } else if (gt.console && gt.console.warn) {
        gt.console.warn('[OnlookMobileClient] installer.install failed:', msg);
    }
}

registerRootComponent(App);

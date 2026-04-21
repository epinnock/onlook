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
    gt.__require = function overlayRequire(specifier) {
        if (specifier === 'react') return React;
        if (specifier === 'react-native') return ReactNative;
        throw new Error('overlay require: unsupported specifier "' + specifier + '"');
    };
    // `renderApp` is what wrap-overlay's emitted bundle calls after it
    // resolves the default export. Use RN's AppRegistry to schedule the
    // element on the existing Fabric root — the simplest way to paint
    // overlay output without standing up a second reconciler (which
    // `runtime.js` does but we can't load here without ReactCurrentDispatcher
    // conflicts). Registers a fresh runnable per call so successive
    // overlays get fresh mount points.
    let _onlookOverlayCounter = 0;
    gt.renderApp = function renderApp(element) {
        const key = 'OnlookOverlay' + String(++_onlookOverlayCounter);
        const OverlayApp = () => element;
        ReactNative.AppRegistry.registerComponent(key, () => OverlayApp);
        ReactNative.AppRegistry.runApplication(key, {
            rootTag: gt.currentRootTag != null ? gt.currentRootTag : 1,
        });
    };
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

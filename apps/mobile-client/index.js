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

import { TurboModuleRegistry } from 'react-native';
import { registerRootComponent } from 'expo';

import App from './src/App';

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

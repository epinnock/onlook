/**
 * shell.js — Bootstrap shell wrapping the React runtime.
 *
 * This gets prepended to the bundled runtime. It handles:
 * - HMRClient registration
 * - RCTDeviceEventEmitter (event pipeline)
 * - Fabric registerEventHandler
 * - WebSocket hot-reload connection
 * - eval message handler
 * - RN$AppRegistry.runApplication → initializes the React reconciler
 *
 * After loading, eval'd code can call:
 *   renderApp(React.createElement(View, {style:{flex:1}}, ...))
 *
 * Two runtime targets:
 *   1. Browser preview shell (Spike B): full bootstrap (websocket eval loop,
 *      Fabric stub, AppRegistry shadow). Triggered when `window` is defined.
 *   2. Onlook Mobile Client (Hermes/RN, MC*): only the JSI installers run.
 *      The browser-preview machinery shadows RN's own primitives and breaks
 *      the reconciler — see plans/post-mortems/2026-04-16-runtime-d-r-clobber.md.
 *      JSI install() calls are idempotent and safe in both modes.
 */

// MC2.3: register native OnlookRuntime host object on globalThis. Must run
// before any other runtime setup so user code never observes a moment where
// OnlookRuntime is undefined. Install method lives in the native TurboModule
// `OnlookRuntimeInstaller` (apps/mobile-client/cpp/OnlookRuntimeInstaller.{h,cpp,mm}).
// Failures are logged via nativeLoggingHook rather than thrown — a missing
// installer should not take the whole runtime down.
(function () {
  try {
    var proxy = globalThis.__turboModuleProxy || globalThis.nativeModuleProxy;
    var installer = null;
    if (typeof proxy === 'function') {
      installer = proxy('OnlookRuntimeInstaller');
    } else if (proxy && typeof proxy === 'object') {
      installer = proxy.OnlookRuntimeInstaller || null;
    }
    if (installer && typeof installer.install === 'function') {
      installer.install();
    } else if (typeof globalThis.nativeLoggingHook === 'function') {
      globalThis.nativeLoggingHook(
        '[onlook-runtime] OnlookRuntimeInstaller not reachable — TurboModule proxy missing',
        1,
      );
    }
  } catch (err) {
    if (typeof globalThis.nativeLoggingHook === 'function') {
      globalThis.nativeLoggingHook(
        '[onlook-runtime] OnlookRuntimeInstaller.install threw: ' + (err && err.message),
        1,
      );
    }
  }
})();

// MC4.1: register native OnlookInspector host object on globalThis. Same
// TurboModule pattern as OnlookRuntime above, separate module name + global
// key. Install lives in `OnlookInspectorInstaller`. Used only by the editor's
// relay-driven tap-to-select / walk-tree / screenshot / highlight flows; user
// bundles that never touch globalThis.OnlookInspector still run.
(function () {
  try {
    var proxy = globalThis.__turboModuleProxy || globalThis.nativeModuleProxy;
    var inspector = null;
    if (typeof proxy === 'function') {
      inspector = proxy('OnlookInspectorInstaller');
    } else if (proxy && typeof proxy === 'object') {
      inspector = proxy.OnlookInspectorInstaller || null;
    }
    if (inspector && typeof inspector.install === 'function') {
      inspector.install();
    } else if (typeof globalThis.nativeLoggingHook === 'function') {
      globalThis.nativeLoggingHook(
        '[onlook-inspector] OnlookInspectorInstaller not reachable — TurboModule proxy missing',
        1,
      );
    }
  } catch (err) {
    if (typeof globalThis.nativeLoggingHook === 'function') {
      globalThis.nativeLoggingHook(
        '[onlook-inspector] OnlookInspectorInstaller.install threw: ' + (err && err.message),
        1,
      );
    }
  }
})();

var bootstrapShell = require('./bootstrap/index.js').bootstrapShell;

module.exports = {
  bootstrapShell: bootstrapShell,
};

// Skip bootstrap only when running inside the custom Onlook Mobile Client:
// the JSI installer above sets `globalThis.OnlookRuntime`, and main.jsbundle
// there owns AppRegistry, HMR, event emitters, and the Fabric event handler.
// In Expo Go (Hermes, no OnlookRuntime TurboModule) and in the browser
// preview spike (no TurboModule proxy) we still need the shell to register
// HMRClient / RCTDeviceEventEmitter / AppRegistry and wire the eval loop —
// otherwise Expo Go's native side calls HMRClient.setup() into a registry
// with n=0 modules and throws.
if (!globalThis.OnlookRuntime && !globalThis.__ONLOOK_SKIP_SHELL_BOOTSTRAP__) {
  bootstrapShell(globalThis);
}

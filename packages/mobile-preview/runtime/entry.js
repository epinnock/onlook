// Entry point: shell first (sets up bootstrap), then runtime (React + reconciler)
require('./shell.js');
// Skip React + reconciler setup when the host explicitly opts out via
// `__noOnlookRuntime`. The Onlook Mobile Client sets this flag in its
// `index.js` because main.jsbundle ships its own React and loading ours
// causes dual-React hooks failures (ReactCurrentDispatcher on the wrong
// copy — see plans/post-mortems/2026-04-16-runtime-d-r-clobber.md).
//
// Expo Go and the browser-preview harness leave the flag unset, so
// runtime.js loads there. shell.js needs `_initReconciler`, `renderApp`,
// and `React` (all defined by runtime.js) to mount the default screen
// from RN$AppRegistry.runApplication; without them Expo Go blanks out
// with a "B13 ERROR: _initReconciler not found" log.
//
// Historical note: this gate previously also required `typeof window
// !== 'undefined'` to detect "browser, not Hermes" — but Expo Go is
// Hermes too, so that check skipped runtime.js in Expo Go and broke the
// preview path. `__noOnlookRuntime` is the only correct discriminator.
if (!globalThis.__noOnlookRuntime) {
  require('./runtime.js');
}

// Entry point: shell first (sets up bootstrap), then runtime (React + reconciler)
require('./shell.js');
// Skip React + reconciler setup when running inside the Onlook Mobile
// Client (Hermes). The main bundle ships its own React; loading ours
// causes dual-React hooks failures (ReactCurrentDispatcher is on the
// wrong copy). See plans/post-mortems/2026-04-16-runtime-d-r-clobber.md.
//
// Detection: browsers have `window` defined at prepend time. Hermes does
// NOT (RN's InitializeCore later sets globalThis.window = globalThis from
// inside main.jsbundle, but that runs AFTER our runtime prelude). Note:
// `__turboModuleProxy` is also RN-only but is set LATE — too late for our
// prepend check. `window` is set by browsers at startup, which is what we
// need.
if (typeof window !== 'undefined') {
  require('./runtime.js');
}

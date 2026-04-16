// Entry point: shell first (sets up bootstrap), then runtime (React + reconciler)
require('./shell.js');
// Skip React + reconciler setup when running inside the Onlook Mobile
// Client (Hermes). The main bundle ships its own React; loading ours
// causes dual-React hooks failures (ReactCurrentDispatcher is on the
// wrong copy). See plans/post-mortems/2026-04-16-runtime-d-r-clobber.md.
if (typeof globalThis.__turboModuleProxy === 'undefined') {
  require('./runtime.js');
}

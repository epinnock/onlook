// Mobile-client entry point — shell.js only, no React + reconciler.
//
// The Onlook Mobile Client (iOS custom Expo Go) bundles its own React via
// main.jsbundle and runs on Hermes + bridgeless + new-arch. Loading our
// react + react-reconciler would cause dual-React hook failures (ADR
// `v2-pipeline-validation-findings.md` finding #3), and runtime.js's
// reconciler calls `UIManager.createView` which is absent in new-arch
// (finding #5).
//
// This entry mirrors `entry.js` MINUS the `require('./runtime.js')` path,
// producing a ~15–20 KB bundle (vs ~264 KB for the full entry.js). Ships to
// mobile-client only; Expo Go / mobile-preview harness continue to use
// `entry.js`.

require('./shell.js');

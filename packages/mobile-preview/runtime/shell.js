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
 */

var bootstrapShell = require('./bootstrap/index.js').bootstrapShell;

module.exports = {
  bootstrapShell: bootstrapShell,
};

if (!globalThis.__ONLOOK_SKIP_SHELL_BOOTSTRAP__) {
  bootstrapShell(globalThis);
}

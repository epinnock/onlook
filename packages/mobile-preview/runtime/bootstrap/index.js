var installSchedulerPolyfills = require('./polyfills.js').installSchedulerPolyfills;
var installLogger = require('./logging.js').installLogger;
var setupFabric = require('./fabric.js').setupFabric;
var installWebSocketBootstrap = require('./websocket.js').installWebSocketBootstrap;
var registerCallableModules = require('./callable-modules.js').registerCallableModules;
var installAppRegistry = require('./app-registry.js').installAppRegistry;

function bootstrapShell(target) {
  installSchedulerPolyfills(target);

  var log = installLogger(target);
  log('shell begin');

  setupFabric(target, log);
  installWebSocketBootstrap(target, log);
  registerCallableModules(target, log);
  log('callable modules registered');
  installAppRegistry(target, log);
  log('shell ready');

  return target;
}

module.exports = {
  bootstrapShell: bootstrapShell,
};

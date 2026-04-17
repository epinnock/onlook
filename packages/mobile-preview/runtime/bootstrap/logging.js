function installLogger(target) {
  // MC1.4.1: production-era prefix. The `[SPIKE_B]` prefix dates back to the
  // Spike B prototype that prototyped the Expo Go bridgeless Fabric mount
  // path. The runtime has been production since 2026-04. The prefix now
  // matches the `[onlook-runtime]` / `[onlook-inspector]` convention used
  // by the JSI installers in `shell.js`.
  target._log = function(msg) {
    try {
      if (typeof target.nativeLoggingHook === 'function') {
        target.nativeLoggingHook('[onlook-runtime] ' + msg, 1);
      }
    } catch (_) {}
  };

  return target._log;
}

module.exports = {
  installLogger: installLogger,
};

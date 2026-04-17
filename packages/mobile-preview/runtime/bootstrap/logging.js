function installLogger(target) {
  target._log = function(msg) {
    try {
      if (typeof target.nativeLoggingHook === 'function') {
        target.nativeLoggingHook('[SPIKE_B] ' + msg, 1);
      }
    } catch (_) {}
  };

  return target._log;
}

module.exports = {
  installLogger: installLogger,
};

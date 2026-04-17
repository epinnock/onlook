var DEFAULT_INITIAL_DELAY_MS = 1000;
var DEFAULT_MAX_DELAY_MS = 30000;

function getWebSocketReconnectDelay(attemptNumber, initialDelayMs, maxDelayMs) {
  var safeAttemptNumber = attemptNumber > 0 ? attemptNumber : 1;
  var baseDelay = initialDelayMs || DEFAULT_INITIAL_DELAY_MS;
  var maxDelay = maxDelayMs || DEFAULT_MAX_DELAY_MS;
  var delay = baseDelay * Math.pow(2, safeAttemptNumber - 1);

  return delay > maxDelay ? maxDelay : delay;
}

function createWebSocketReconnectManager(options) {
  var config = options || {};
  var connect = config.connect;
  var clearTimer = config.clearTimeout || clearTimeout;
  var initialDelayMs = config.initialDelayMs || DEFAULT_INITIAL_DELAY_MS;
  var log = config.log || function() {};
  var maxDelayMs = config.maxDelayMs || DEFAULT_MAX_DELAY_MS;
  var scheduleTimer = config.setTimeout || setTimeout;

  var attemptCount = 0;
  var lastConnection = null;
  var reconnectDelayMs = null;
  var reconnectTimer = null;

  function clearReconnectTimer() {
    if (reconnectTimer === null) {
      return;
    }

    clearTimer(reconnectTimer);
    reconnectTimer = null;
    reconnectDelayMs = null;
  }

  function runConnect(host, port) {
    if (typeof connect === 'function') {
      connect(host, port);
    }
  }

  return {
    cancel: function() {
      clearReconnectTimer();
    },

    connectNow: function(host, port) {
      if (typeof host !== 'string' || host.length === 0) {
        return false;
      }

      attemptCount = 0;
      lastConnection = { host: host, port: port };
      clearReconnectTimer();
      runConnect(host, port);
      return true;
    },

    getState: function() {
      return {
        attemptCount: attemptCount,
        hasPendingReconnect: reconnectTimer !== null,
        host: lastConnection ? lastConnection.host : null,
        port: lastConnection ? lastConnection.port : null,
        reconnectDelayMs: reconnectDelayMs,
      };
    },

    markConnected: function() {
      attemptCount = 0;
      clearReconnectTimer();
    },

    scheduleReconnect: function(reason) {
      if (!lastConnection || reconnectTimer !== null) {
        return false;
      }

      attemptCount += 1;
      reconnectDelayMs = getWebSocketReconnectDelay(
        attemptCount,
        initialDelayMs,
        maxDelayMs,
      );

      log(
        'ws: reconnect in ' +
          reconnectDelayMs +
          'ms' +
          (reason ? ' (' + reason + ')' : ''),
      );

      reconnectTimer = scheduleTimer(function() {
        reconnectTimer = null;
        reconnectDelayMs = null;
        runConnect(lastConnection.host, lastConnection.port);
      }, reconnectDelayMs);

      return true;
    },
  };
}

module.exports = {
  createWebSocketReconnectManager: createWebSocketReconnectManager,
  getWebSocketReconnectDelay: getWebSocketReconnectDelay,
};

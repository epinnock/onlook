var DEFAULT_PING_INTERVAL_MS = 15000;
var DEFAULT_PING_TIMEOUT_MS = 5000;

function createWebSocketKeepaliveManager(options) {
  var config = options || {};
  var clearTimer = config.clearTimeout || clearTimeout;
  var handleDeadConnection = config.handleDeadConnection || function() {};
  var log = config.log || function() {};
  var pingIntervalMs = config.pingIntervalMs || DEFAULT_PING_INTERVAL_MS;
  var pingTimeoutMs = config.pingTimeoutMs || DEFAULT_PING_TIMEOUT_MS;
  var scheduleTimer = config.setTimeout || setTimeout;
  var sendPing = config.sendPing || function() {};

  var connected = false;
  var pingTimer = null;
  var timeoutTimer = null;
  var waitingForActivity = false;

  function clearPingTimer() {
    if (pingTimer === null) {
      return;
    }

    clearTimer(pingTimer);
    pingTimer = null;
  }

  function clearTimeoutTimer() {
    if (timeoutTimer === null) {
      return;
    }

    clearTimer(timeoutTimer);
    timeoutTimer = null;
  }

  function clearAllTimers() {
    clearPingTimer();
    clearTimeoutTimer();
  }

  function handleTimeout(reason) {
    waitingForActivity = false;
    connected = false;
    clearAllTimers();
    log('ws: dead connection detected (' + reason + ')');
    handleDeadConnection(reason);
  }

  function schedulePing() {
    if (!connected || pingTimer !== null) {
      return false;
    }

    pingTimer = scheduleTimer(function() {
      pingTimer = null;
      if (!connected) {
        return;
      }

      waitingForActivity = true;

      try {
        sendPing();
      } catch (error) {
        var message = error && error.message ? error.message : 'ping failed';
        log('ws: keepalive ping failed: ' + message);
        handleTimeout('keepalive ping failed');
        return;
      }

      timeoutTimer = scheduleTimer(function() {
        timeoutTimer = null;
        if (!connected || !waitingForActivity) {
          return;
        }

        handleTimeout('keepalive timeout');
      }, pingTimeoutMs);
    }, pingIntervalMs);

    return true;
  }

  return {
    getState: function() {
      return {
        connected: connected,
        hasPendingPing: pingTimer !== null,
        hasPendingTimeout: timeoutTimer !== null,
        waitingForActivity: waitingForActivity,
      };
    },

    markActivity: function() {
      if (!connected) {
        return false;
      }

      waitingForActivity = false;
      clearTimeoutTimer();
      clearPingTimer();
      schedulePing();
      return true;
    },

    markConnected: function() {
      connected = true;
      waitingForActivity = false;
      clearAllTimers();
      schedulePing();
    },

    markDisconnected: function() {
      connected = false;
      waitingForActivity = false;
      clearAllTimers();
    },
  };
}

module.exports = {
  createWebSocketKeepaliveManager: createWebSocketKeepaliveManager,
  DEFAULT_PING_INTERVAL_MS: DEFAULT_PING_INTERVAL_MS,
  DEFAULT_PING_TIMEOUT_MS: DEFAULT_PING_TIMEOUT_MS,
};

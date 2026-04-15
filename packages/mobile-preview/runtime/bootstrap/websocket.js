var createWebSocketReconnectManager =
  require('./ws-reconnect.js').createWebSocketReconnectManager;
var createWebSocketKeepaliveManager =
  require('./keepalive.js').createWebSocketKeepaliveManager;

var MOBILE_PREVIEW_WS_PORT = 8788;
var SOCKET_ID = 42;

function resolveWebSocketModule(target) {
  var proxy = target.__turboModuleProxy || target.nativeModuleProxy;
  if (!proxy) {
    return null;
  }

  try {
    return proxy.WebSocketModule || (typeof proxy === 'function' ? proxy('WebSocketModule') : null);
  } catch (_) {
    return null;
  }
}

function getRuntimeTimer(target, name, fallback) {
  var timer = target && typeof target[name] === 'function' ? target[name] : fallback;
  return timer.bind ? timer.bind(target) : timer;
}

function getWebSocketPort(target) {
  var port = target && (target.mobilePreviewWsPort || target.__ONLOOK_MOBILE_PREVIEW_WS_PORT__);
  return typeof port === 'number' && port > 0 ? port : MOBILE_PREVIEW_WS_PORT;
}

function registerWebSocketListeners(target, wsModule) {
  if (target._registeredWebSocketModule === wsModule) {
    return;
  }

  var events = ['websocketOpen', 'websocketMessage', 'websocketClosed', 'websocketFailed'];
  for (var i = 0; i < events.length; i++) {
    try {
      wsModule.addListener(events[i]);
    } catch (_) {}
  }

  target._registeredWebSocketModule = wsModule;
}

function installWebSocketBootstrap(target, log) {
  target.wsConnected = false;
  target.wsModule = null;
  target._registeredWebSocketModule = null;
  target._wsReconnect = createWebSocketReconnectManager({
    clearTimeout: getRuntimeTimer(target, 'clearTimeout', clearTimeout),
    connect: function(host, port) {
      target._connectWebSocketNow(host, port);
    },
    log: log,
    setTimeout: getRuntimeTimer(target, 'setTimeout', setTimeout),
  });
  target._wsKeepalive = createWebSocketKeepaliveManager({
    clearTimeout: getRuntimeTimer(target, 'clearTimeout', clearTimeout),
    handleDeadConnection: function(reason) {
      target.wsConnected = false;
      if (target.wsModule && typeof target.wsModule.close === 'function') {
        try {
          target.wsModule.close(SOCKET_ID);
        } catch (_) {}
      }
      target._scheduleWebSocketReconnect(reason);
    },
    log: log,
    sendPing: function() {
      if (!target.wsModule || typeof target.wsModule.send !== 'function') {
        throw new Error('WebSocketModule.send unavailable');
      }

      log('B13 ws: keepalive ping');
      target.wsModule.send(JSON.stringify({ type: 'ping' }), SOCKET_ID);
    },
    setTimeout: getRuntimeTimer(target, 'setTimeout', setTimeout),
  });

  target._handleMessage = function(msg) {
    if (msg.type === 'eval' && msg.code) {
      log('B13 eval: ' + msg.code.substring(0, 150));
      try {
        var result = (0, eval)(msg.code);
        log('B13 eval OK');
        if (target.wsModule) {
          try {
            target.wsModule.send(JSON.stringify({ type: 'evalResult', result: String(result) }), 42);
          } catch (_) {}
        }
      } catch (error) {
        log('B13 eval ERROR: ' + error.message);
        if (error.stack) {
          log('B13 stack: ' + error.stack.substring(0, 400));
        }
        if (target.wsModule) {
          try {
            target.wsModule.send(JSON.stringify({ type: 'evalError', error: error.message }), 42);
          } catch (_) {}
        }
      }
    }
  };

  target._connectWebSocketNow = function(host, port) {
    var wsModule = resolveWebSocketModule(target);
    if (!wsModule) {
      log('B13 ws: no module proxy');
      target._wsKeepalive.markDisconnected();
      target._scheduleWebSocketReconnect('module unavailable');
      return;
    }

    if (typeof wsModule.connect !== 'function') {
      log('B13 ws: WebSocketModule not available');
      target._wsKeepalive.markDisconnected();
      target._scheduleWebSocketReconnect('module unavailable');
      return;
    }

    target.wsModule = wsModule;
    target._wsKeepalive.markDisconnected();
    registerWebSocketListeners(target, wsModule);

    var resolvedPort = port || getWebSocketPort(target);
    var url = 'ws://' + host + ':' + resolvedPort;
    log('B13 ws: connecting to ' + url);

    try {
      target.wsModule.connect(url, [], {}, SOCKET_ID);
      log('B13 ws: connect() called');
    } catch (error) {
      log('B13 ws: connect error: ' + error.message);
      target._wsKeepalive.markDisconnected();
      target._scheduleWebSocketReconnect('connect error');
    }
  };

  target._markWebSocketConnected = function() {
    target._wsReconnect.markConnected();
    target._wsKeepalive.markConnected();
  };

  target._markWebSocketAlive = function() {
    target._wsKeepalive.markActivity();
  };

  target._markWebSocketDisconnected = function() {
    target._wsKeepalive.markDisconnected();
  };

  target._scheduleWebSocketReconnect = function(reason) {
    return target._wsReconnect.scheduleReconnect(reason);
  };

  target._tryConnectWebSocket = function(host, port) {
    var reconnectPort = getWebSocketPort(target);
    return target._wsReconnect.connectNow(host, reconnectPort);
  };
}

module.exports = {
  installWebSocketBootstrap: installWebSocketBootstrap,
};

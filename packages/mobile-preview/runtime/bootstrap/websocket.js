function installWebSocketBootstrap(target, log) {
  target.wsConnected = false;
  target.wsModule = null;

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

  target._tryConnectWebSocket = function(host) {
    var proxy = target.__turboModuleProxy || target.nativeModuleProxy;
    if (!proxy) {
      log('B13 ws: no module proxy');
      return;
    }

    try {
      target.wsModule =
        proxy.WebSocketModule || (typeof proxy === 'function' ? proxy('WebSocketModule') : null);
    } catch (_) {}

    if (!target.wsModule || typeof target.wsModule.connect !== 'function') {
      log('B13 ws: WebSocketModule not available');
      return;
    }

    var events = ['websocketOpen', 'websocketMessage', 'websocketClosed', 'websocketFailed'];
    for (var i = 0; i < events.length; i++) {
      try {
        target.wsModule.addListener(events[i]);
      } catch (_) {}
    }

    var url = 'ws://' + host + ':8788';
    log('B13 ws: connecting to ' + url);

    try {
      target.wsModule.connect(url, [], {}, 42);
      log('B13 ws: connect() called');
    } catch (error) {
      log('B13 ws: connect error: ' + error.message);
    }
  };
}

module.exports = {
  installWebSocketBootstrap: installWebSocketBootstrap,
};

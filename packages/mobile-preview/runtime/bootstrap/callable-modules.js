function registerCallableModules(target, log) {
  target.RN$registerCallableModule('HMRClient', function() {
    return {
      setup: function(platform, bundleEntry, host, port) {
        log('B13 HMRClient.setup host=' + host + ' port=' + port);
        target._tryConnectWebSocket(host, port);
      },
      enable: function() {},
      disable: function() {},
      registerBundle: function() {},
      log: function() {},
      unstable_notifyFuseboxJsBundleLoaded: function() {},
    };
  });

  target.RN$registerCallableModule('RCTDeviceEventEmitter', function() {
    return {
      emit: function(eventName) {
        var args = Array.prototype.slice.call(arguments, 1);
        var event = args[0] || {};

        if (eventName === 'websocketOpen' && event.id === 42) {
          target.wsConnected = true;
          log('B13 ws: CONNECTED');
          return;
        }

        if (eventName === 'websocketMessage' && event.id === 42) {
          try {
            target._handleMessage(JSON.parse(event.data));
          } catch (error) {
            log('B13 ws parse err: ' + error.message);
          }
          return;
        }

        if (eventName === 'websocketClosed' && event.id === 42) {
          target.wsConnected = false;
          log('B13 ws: CLOSED');
          return;
        }

        if (eventName === 'websocketFailed' && event.id === 42) {
          target.wsConnected = false;
          log('B13 ws: FAILED ' + event.message);
        }
      },
      addListener: function() {},
      removeListener: function() {},
      removeAllListeners: function() {},
    };
  });

  target.RN$registerCallableModule('RCTNativeAppEventEmitter', function() {
    return {
      emit: function() {},
      addListener: function() {},
      removeListener: function() {},
      removeAllListeners: function() {},
    };
  });
}

module.exports = {
  registerCallableModules: registerCallableModules,
};

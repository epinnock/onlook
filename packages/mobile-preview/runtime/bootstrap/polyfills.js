function getTimerModule(target) {
  var timerModule = null;

  try {
    var proxy = target.__turboModuleProxy || target.nativeModuleProxy;
    if (proxy) {
      timerModule = proxy.Timing || proxy.RCTTiming;
    }
  } catch (_) {}

  return timerModule;
}

function installSchedulerPolyfills(target) {
  if (typeof target.setTimeout === 'undefined') {
    var timerId = 1;
    var timers = {};
    var timerModule = getTimerModule(target);

    if (timerModule && typeof timerModule.createTimer === 'function') {
      target.setTimeout = function(fn, ms) {
        var id = timerId++;
        timers[id] = fn;
        timerModule.createTimer(id, ms || 0, Date.now(), false);
        return id;
      };

      target.clearTimeout = function(id) {
        delete timers[id];
      };

      target.RN$registerCallableModule('JSTimers', function() {
        return {
          callTimers: function(ids) {
            for (var i = 0; i < ids.length; i++) {
              var fn = timers[ids[i]];
              if (fn) {
                delete timers[ids[i]];
                fn();
              }
            }
          },
          callIdleCallbacks: function() {},
          callImmediates: function() {},
        };
      });
    } else {
      target.setTimeout = function(fn) {
        fn();
        return timerId++;
      };

      target.clearTimeout = function() {};
    }
  }

  if (typeof target.MessageChannel === 'undefined') {
    target.MessageChannel = function() {
      var callback = null;

      this.port1 = { onmessage: null };
      this.port2 = {
        postMessage: function() {
          if (callback) {
            var fn = callback;
            target.setTimeout(function() {
              fn({ data: undefined });
            }, 0);
          }
        },
      };

      Object.defineProperty(this.port1, 'onmessage', {
        set: function(value) {
          callback = value;
        },
        get: function() {
          return callback;
        },
      });
    };
  }

  if (typeof target.performance === 'undefined') {
    target.performance = {
      now: function() {
        return Date.now();
      },
    };
  }
}

module.exports = {
  installSchedulerPolyfills: installSchedulerPolyfills,
};

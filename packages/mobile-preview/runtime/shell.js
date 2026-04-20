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

// Scheduler polyfill — react-reconciler needs setTimeout/clearTimeout
if (typeof globalThis.setTimeout === 'undefined') {
  // Use the native timer module if available
  var _timerId = 1;
  var _timers = {};
  var _timerModule = null;

  try {
    var proxy = globalThis.__turboModuleProxy || globalThis.nativeModuleProxy;
    if (proxy) {
      _timerModule = proxy.Timing || proxy.RCTTiming;
    }
  } catch(e) {}

  if (_timerModule && typeof _timerModule.createTimer === 'function') {
    globalThis.setTimeout = function(fn, ms) {
      var id = _timerId++;
      _timers[id] = fn;
      _timerModule.createTimer(id, ms || 0, Date.now(), false);
      return id;
    };
    globalThis.clearTimeout = function(id) {
      delete _timers[id];
    };
    // Timer callback dispatcher
    globalThis.RN$registerCallableModule('JSTimers', function() {
      return {
        callTimers: function(ids) {
          for (var i = 0; i < ids.length; i++) {
            var fn = _timers[ids[i]];
            if (fn) {
              delete _timers[ids[i]];
              fn();
            }
          }
        },
        callIdleCallbacks: function() {},
        callImmediates: function() {},
      };
    });
  } else {
    // Fallback: synchronous setTimeout (not ideal but works for initial render)
    globalThis.setTimeout = function(fn, ms) {
      fn();
      return _timerId++;
    };
    globalThis.clearTimeout = function() {};
  }
}

// MessageChannel polyfill (scheduler uses this)
if (typeof globalThis.MessageChannel === 'undefined') {
  globalThis.MessageChannel = function() {
    var cb = null;
    this.port1 = { onmessage: null };
    this.port2 = {
      postMessage: function() {
        if (cb) {
          var fn = cb;
          // Use setTimeout if available (might be our polyfill above)
          globalThis.setTimeout(function() {
            fn({ data: undefined });
          }, 0);
        }
      }
    };
    // Getter/setter to wire up the callback
    var self = this;
    Object.defineProperty(this.port1, 'onmessage', {
      set: function(v) { cb = v; },
      get: function() { return cb; },
    });
  };
}

// performance.now polyfill
if (typeof globalThis.performance === 'undefined') {
  globalThis.performance = { now: function() { return Date.now(); } };
}

// --- Logging ---
globalThis._log = function(msg) {
  try {
    if (typeof globalThis.nativeLoggingHook === 'function') {
      globalThis.nativeLoggingHook('[SPIKE_B] ' + msg, 1);
    }
  } catch (_) {}
};

_log('B13 shell begin');

// --- Fabric setup ---
globalThis.fab = globalThis.nativeFabricUIManager;
if (!globalThis.fab) throw new Error('B13: nativeFabricUIManager missing');

globalThis.fab.registerEventHandler(function() {});
_log('B13 fabric.registerEventHandler OK');

// --- Callable modules ---
globalThis.RN$registerCallableModule('HMRClient', function() {
  return {
    setup: function(platform, bundleEntry, host, port, isEnabled, scheme) {
      _log('B13 HMRClient.setup host=' + host + ' port=' + port);
      _tryConnectWebSocket(host, port);
    },
    enable: function(){}, disable: function(){},
    registerBundle: function(){}, log: function(){},
    unstable_notifyFuseboxJsBundleLoaded: function(){},
  };
});

globalThis.RN$registerCallableModule('RCTDeviceEventEmitter', function() {
  return {
    emit: function(eventName) {
      var args = Array.prototype.slice.call(arguments, 1);
      var evt = args[0] || {};
      if (eventName === 'websocketOpen' && evt.id === 42) {
        globalThis.wsConnected = true;
        _log('B13 ws: CONNECTED');
        return;
      }
      if (eventName === 'websocketMessage' && evt.id === 42) {
        try { _handleMessage(JSON.parse(evt.data)); } catch(e) { _log('B13 ws parse err: ' + e.message); }
        return;
      }
      if (eventName === 'websocketClosed' && evt.id === 42) {
        globalThis.wsConnected = false;
        _log('B13 ws: CLOSED');
        return;
      }
      if (eventName === 'websocketFailed' && evt.id === 42) {
        globalThis.wsConnected = false;
        _log('B13 ws: FAILED ' + evt.message);
        return;
      }
    },
    addListener: function(){}, removeListener: function(){}, removeAllListeners: function(){},
  };
});

globalThis.RN$registerCallableModule('RCTNativeAppEventEmitter', function() {
  return { emit: function(){}, addListener: function(){}, removeListener: function(){}, removeAllListeners: function(){} };
});

_log('B13 callable modules registered');

// --- WebSocket ---
globalThis.wsConnected = false;
globalThis.wsModule = null;

globalThis._tryConnectWebSocket = function(host, port) {
  var proxy = globalThis.__turboModuleProxy || globalThis.nativeModuleProxy;
  if (!proxy) { _log('B13 ws: no module proxy'); return; }

  try {
    globalThis.wsModule = proxy.WebSocketModule || (typeof proxy === 'function' ? proxy('WebSocketModule') : null);
  } catch(e) {}

  if (!globalThis.wsModule || typeof globalThis.wsModule.connect !== 'function') {
    _log('B13 ws: WebSocketModule not available');
    return;
  }

  var events = ['websocketOpen','websocketMessage','websocketClosed','websocketFailed'];
  for (var i = 0; i < events.length; i++) {
    try { globalThis.wsModule.addListener(events[i]); } catch(_) {}
  }

  var url = 'ws://' + host + ':8788';
  _log('B13 ws: connecting to ' + url);
  try {
    globalThis.wsModule.connect(url, [], {}, 42);
    _log('B13 ws: connect() called');
  } catch(e) {
    _log('B13 ws: connect error: ' + e.message);
  }
};

// --- Eval handler ---
globalThis._handleMessage = function(msg) {
  if (msg.type === 'eval' && msg.code) {
    _log('B13 eval: ' + msg.code.substring(0, 150));
    try {
      var result = (0, eval)(msg.code);
      _log('B13 eval OK');
      if (globalThis.wsModule) {
        try { globalThis.wsModule.send(JSON.stringify({type:'evalResult', result: String(result)}), 42); } catch(_) {}
      }
    } catch(e) {
      _log('B13 eval ERROR: ' + e.message);
      if (e.stack) _log('B13 stack: ' + e.stack.substring(0, 400));
      if (globalThis.wsModule) {
        try { globalThis.wsModule.send(JSON.stringify({type:'evalError', error: e.message}), 42); } catch(_) {}
      }
    }
    return;
  }
};

// --- RN$AppRegistry ---
globalThis.currentRootTag = null;
globalThis.global = globalThis; // make 'global' accessible from eval

globalThis.RN$AppRegistry = {
  runApplication: function(appKey, props) {
    _log('B13 runApplication rootTag=' + props.rootTag);
    globalThis.currentRootTag = props.rootTag;

    // Initialize the React reconciler (imported from runtime.js)
    if (typeof globalThis._initReconciler === 'function') {
      globalThis._initReconciler(globalThis.fab, props.rootTag);
      _log('B13 React reconciler initialized');
    } else {
      _log('B13 ERROR: _initReconciler not found — runtime not loaded?');
    }

    // Render a default "loading" screen
    if (typeof globalThis.renderApp === 'function' && typeof globalThis.React !== 'undefined') {
      var R = globalThis.React;
      globalThis.renderApp(
        R.createElement('View', { style: { flex: 1, backgroundColor: 0xFF2d1b69 | 0, justifyContent: 'center', alignItems: 'center' } },
          R.createElement('RCTText', { style: { fontSize: 24, fontWeight: '700', color: 0xFFFFFFFF | 0 } },
            R.createElement('RCTRawText', { text: 'Onlook Runtime Ready' })
          ),
          R.createElement('RCTText', { style: { fontSize: 14, color: 0xFFA78BFA | 0, marginTop: 12 } },
            R.createElement('RCTRawText', { text: 'Waiting for component code...' })
          )
        )
      );
      _log('B13 default screen rendered');
    }
  },
};

_log('B13 shell ready');

// ── Onlook Mobile Client mount bridge ─────────────────────────────────────
// The native C++ `OnlookRuntime::runApplication(bundleSource, props)` looks
// for `globalThis.onlookMount(props)` after eval. In Expo Go the bundle's
// RN$AppRegistry.runApplication is triggered by RN's native bootstrap, but
// on the mobile-client we're eval'ing this bundle on-demand inside an
// already-running RN app, so nothing calls it. Define onlookMount here so
// the mount-convention path in OnlookRuntime_runApplication.cpp fires.
//
// rootTag resolution: prefer props.rootTag (if the native side ever injects
// one), fall back to globalThis.currentRootTag, then to 1 (RN's default
// first Fabric surface on new-arch). Reconciler init on a tag that already
// has a React tree attached will clobber the host app's LauncherScreen —
// which is what the caller wants: render the preview on top.
globalThis.onlookMount = function onlookMount(props) {
  var rootTag =
    (props && typeof props.rootTag === 'number') ? props.rootTag
    : (typeof globalThis.currentRootTag === 'number' && globalThis.currentRootTag) ? globalThis.currentRootTag
    : 11;
  _log('B13 onlookMount invoked rootTag=' + rootTag + ' sessionId=' + (props && props.sessionId));
  try {
    // Call the runtime helpers DIRECTLY — RN AppRegistry overwrites our
    // shell.js stub during main-bundle eval, so going through it hits RN's
    // runnables map which knows OnlookMobileClient but not OnlookApp.
    if (typeof globalThis._initReconciler !== 'function') {
      _log('B13 onlookMount: _initReconciler missing'); return;
    }
    if (typeof globalThis.renderApp !== 'function') {
      _log('B13 onlookMount: renderApp missing'); return;
    }
    if (!globalThis.fab) {
      _log('B13 onlookMount: fab missing'); return;
    }
    globalThis.currentRootTag = rootTag;
    globalThis._initReconciler(globalThis.fab, rootTag);
    _log('B13 onlookMount: reconciler initialized for rootTag=' + rootTag);
    var R = globalThis.React;
    if (!R) { _log('B13 onlookMount: React missing'); return; }
    globalThis.renderApp(
      R.createElement('View', { style: { flex: 1, backgroundColor: 0xFF2d1b69 | 0, justifyContent: 'center', alignItems: 'center' } },
        R.createElement('RCTText', { style: { fontSize: 24, fontWeight: '700', color: 0xFFFFFFFF | 0 } },
          R.createElement('RCTRawText', { text: 'Onlook Runtime Ready' })
        ),
        R.createElement('RCTText', { style: { fontSize: 14, color: 0xFFA78BFA | 0, marginTop: 12 } },
          R.createElement('RCTRawText', { text: 'Waiting for component code...' })
        )
      )
    );
    _log('B13 onlookMount: renderApp returned (rootTag=' + rootTag + ')');
    // Connect WS to relay so component-code pushes can arrive
    try {
      if (typeof globalThis._tryConnectWebSocket === 'function') {
        var host = (props && props.relayHost) || '192.168.0.17';
        var port = (props && props.relayPort) || 8788;
        _log('B13 onlookMount: connecting WS to ' + host + ':' + port);
        globalThis._tryConnectWebSocket(host, port);
      }
    } catch (wsErr) { _log('B13 onlookMount WS err: ' + (wsErr && wsErr.message)); }
  } catch (e) {
    _log('B13 onlookMount ERROR: ' + (e && e.message));
    if (e && e.stack) _log('B13 onlookMount stack: ' + e.stack.substring(0, 400));
  }
};
_log('B13 onlookMount installed');

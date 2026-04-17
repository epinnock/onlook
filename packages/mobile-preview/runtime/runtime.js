/**
 * runtime.js — Onlook Fabric Runtime.
 *
 * Explicitly wires React internals to avoid double-__toESM wrapping issues.
 */

const React = require('react');
const ReconcilerFactory = require('react-reconciler');
const { createHostConfig } = require('./fabric-host-config.js');
const nativeModulesShim = require('./shims/core/native-modules.js');

// Debug: verify internals
const g = globalThis;
const internalsKey = '__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE';
g._log('runtime: React type=' + typeof React);
g._log('runtime: React.createElement=' + typeof React.createElement);
g._log('runtime: React[internalsKey]=' + typeof React[internalsKey]);

// If internals are on default (ESM interop), try that
if (!React[internalsKey] && React.default && React.default[internalsKey]) {
  g._log('runtime: fixing internals from React.default');
  React[internalsKey] = React.default[internalsKey];
}

let _fab = null;
let _rootTag = null;
let _container = null;
let _reconciler = null;

function initReconciler(fab, rootTag) {
  _fab = fab;
  _rootTag = rootTag;

  g._log('runtime: creating host config');
  const hostConfig = createHostConfig(fab, rootTag);

  g._log('runtime: creating reconciler');
  _reconciler = ReconcilerFactory(hostConfig);

  g._log('runtime: creating container');
  _container = _reconciler.createContainer(
    { children: [] },
    0, // LegacyRoot
    null,
    false,
    null,
    '',
    function(err) { g._log('uncaught: ' + (err && err.message)); },
    function(err) { g._log('caught: ' + (err && err.message)); },
    function(err) { g._log('recoverable: ' + (err && err.message)); },
    null,
  );
  g._log('runtime: container created');
}

let _renderSeq = 0;
function renderApp(element) {
  if (!_reconciler || !_container) {
    throw new Error('Runtime not initialized');
  }
  // Fabric on Expo Go SDK 54 de-dupes a commit when the root child's reactTag
  // is unchanged — React reuses the root host instance across renders and
  // cloneNodeWithNewProps preserves the tag, so subsequent `completeRoot`
  // calls become no-ops and the screen never updates. Wrap every render in a
  // Fragment and re-key the child to force a fresh host instance + new tag
  // on every push, which breaks the dedupe. See plans/post-mortems for the
  // full trace.
  _renderSeq += 1;
  const keyed = React.createElement(React.Fragment, null,
    element && typeof element === 'object' && element.key == null
      ? React.cloneElement(element, { key: '__onlook_render_' + _renderSeq })
      : element,
  );
  _reconciler.updateContainer(keyed, _container, null, null);
}

// --- Expose on globalThis ---
const R = React.default || React;
g.React = R;
g.createElement = R.createElement;
g.useState = R.useState;
g.useEffect = R.useEffect;
g.useRef = R.useRef;
g.useMemo = R.useMemo;
g.useCallback = R.useCallback;

g.View = 'View';
g.Text = 'RCTText';
g.RawText = 'RCTRawText';

const nativeModuleBridge = nativeModulesShim.install(g);
g.NativeModules = nativeModuleBridge.NativeModules;
g.TurboModuleRegistry = nativeModuleBridge.TurboModuleRegistry;

// TextC: auto-wraps string children in RCTRawText
g.TextC = function TextC(props) {
  const { children, ...rest } = props;
  const kids = Array.isArray(children) ? children : [children];
  return R.createElement('RCTText', rest,
    ...kids.map(function(child, i) {
      return typeof child === 'string' || typeof child === 'number'
        ? R.createElement('RCTRawText', { key: i, text: String(child) })
        : child;
    })
  );
};

g.renderApp = renderApp;
g._initReconciler = initReconciler;

module.exports = {
  React: R,
  NativeModules: nativeModuleBridge.NativeModules,
  TurboModuleRegistry: nativeModuleBridge.TurboModuleRegistry,
  renderApp,
  initReconciler,
};

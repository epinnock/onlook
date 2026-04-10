/**
 * runtime.js — Onlook Fabric Runtime.
 *
 * Explicitly wires React internals to avoid double-__toESM wrapping issues.
 */

const React = require('react');
const ReconcilerFactory = require('react-reconciler');
const { createHostConfig } = require('./fabric-host-config.js');

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

function renderApp(element) {
  if (!_reconciler || !_container) {
    throw new Error('Runtime not initialized');
  }
  _reconciler.updateContainer(element, _container, null, null);
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

module.exports = { React: R, renderApp, initReconciler };

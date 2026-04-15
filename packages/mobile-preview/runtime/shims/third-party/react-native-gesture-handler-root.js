const MODULE_ID = 'react-native-gesture-handler';
const RUNTIME_SHIM_REGISTRY_KEY = '__onlookShims';

function ensureRuntimeShimRegistry(target) {
  if (!target || typeof target !== 'object') {
    throw new TypeError('react-native-gesture-handler root shim requires an object target');
  }

  if (!target[RUNTIME_SHIM_REGISTRY_KEY] || typeof target[RUNTIME_SHIM_REGISTRY_KEY] !== 'object') {
    target[RUNTIME_SHIM_REGISTRY_KEY] = {};
  }

  return target[RUNTIME_SHIM_REGISTRY_KEY];
}

function resolveReact(target) {
  const candidate = target && target.React;

  if (candidate && typeof candidate === 'object' && candidate.default) {
    return candidate.default;
  }

  if (candidate) {
    return candidate;
  }

  return require('react');
}

function resolveViewType(target) {
  return target && target.View ? target.View : 'View';
}

function buildRootViewProps(props) {
  const {
    accessibilityLabel,
    accessibilityRole,
    nativeID,
    pointerEvents,
    style,
    testID,
  } = props || {};
  const nextProps = {};

  if (accessibilityLabel != null) {
    nextProps.accessibilityLabel = accessibilityLabel;
  }

  if (accessibilityRole != null) {
    nextProps.accessibilityRole = accessibilityRole;
  }

  if (nativeID != null) {
    nextProps.nativeID = nativeID;
  }

  if (pointerEvents != null) {
    nextProps.pointerEvents = pointerEvents;
  }

  if (style != null) {
    nextProps.style = style;
  }

  if (testID != null) {
    nextProps.testID = testID;
  }

  return nextProps;
}

function createGestureHandlerRootView(target) {
  function GestureHandlerRootView(props) {
    const React = resolveReact(target);

    return React.createElement(
      resolveViewType(target),
      buildRootViewProps(props),
      props?.children,
    );
  }

  GestureHandlerRootView.displayName = 'GestureHandlerRootView';
  return GestureHandlerRootView;
}

function createGestureHandlerRootHOC(target, RootView) {
  return function gestureHandlerRootHOC(Component, containerProps) {
    function GestureHandlerRootHOC(props) {
      const React = resolveReact(target);

      return React.createElement(
        RootView,
        buildRootViewProps(containerProps),
        React.createElement(Component, props),
      );
    }

    const componentName =
      Component.displayName || Component.name || 'Component';
    GestureHandlerRootHOC.displayName = `gestureHandlerRootHOC(${componentName})`;
    return GestureHandlerRootHOC;
  };
}

function mergeRuntimeModule(existingModule, nextModule) {
  for (const [key, value] of Object.entries(nextModule)) {
    if (!(key in existingModule)) {
      existingModule[key] = value;
    }
  }

  if (!('default' in existingModule) || existingModule.default == null || existingModule.default === nextModule.default) {
    existingModule.default = existingModule;
  }

  existingModule.__esModule = true;
  return existingModule;
}

function createReactNativeGestureHandlerRootModule(target = globalThis) {
  const GestureHandlerRootView = createGestureHandlerRootView(target);

  const moduleExports = {
    GestureHandlerRootView,
    gestureHandlerRootHOC: createGestureHandlerRootHOC(target, GestureHandlerRootView),
  };

  moduleExports.default = moduleExports;
  moduleExports.__esModule = true;

  return moduleExports;
}

function installReactNativeGestureHandlerRoot(target = globalThis) {
  const registry = ensureRuntimeShimRegistry(target);
  const existingModule = registry[MODULE_ID];
  const gestureHandlerRootModule =
    createReactNativeGestureHandlerRootModule(target);

  if (existingModule && typeof existingModule === 'object') {
    return mergeRuntimeModule(existingModule, gestureHandlerRootModule);
  }

  registry[MODULE_ID] = gestureHandlerRootModule;
  return gestureHandlerRootModule;
}

module.exports = installReactNativeGestureHandlerRoot;
module.exports.install = installReactNativeGestureHandlerRoot;
module.exports.applyRuntimeShim = installReactNativeGestureHandlerRoot;
module.exports.createReactNativeGestureHandlerRootModule =
  createReactNativeGestureHandlerRootModule;
module.exports.ensureRuntimeShimRegistry = ensureRuntimeShimRegistry;
module.exports.mergeRuntimeModule = mergeRuntimeModule;
module.exports.MODULE_ID = MODULE_ID;
module.exports.RUNTIME_SHIM_REGISTRY_KEY = RUNTIME_SHIM_REGISTRY_KEY;

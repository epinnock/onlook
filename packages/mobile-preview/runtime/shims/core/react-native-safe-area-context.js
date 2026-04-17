const MODULE_ID = 'react-native-safe-area-context';
const RUNTIME_SHIM_REGISTRY_KEY = '__onlookShims';
const ZERO_INSETS = Object.freeze({ top: 0, right: 0, bottom: 0, left: 0 });

function ensureRuntimeShimRegistry(target) {
  if (!target || typeof target !== 'object') {
    throw new TypeError('safe-area shim requires an object target');
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

function buildSafeAreaViewProps(props) {
  const {
    style,
    testID,
    nativeID,
    accessibilityLabel,
    accessibilityRole,
    pointerEvents,
  } = props || {};
  const nextProps = {};

  if (style) {
    nextProps.style = style;
  }

  if (testID != null) {
    nextProps.testID = testID;
  }

  if (nativeID != null) {
    nextProps.nativeID = nativeID;
  }

  if (accessibilityLabel != null) {
    nextProps.accessibilityLabel = accessibilityLabel;
  }

  if (accessibilityRole != null) {
    nextProps.accessibilityRole = accessibilityRole;
  }

  if (pointerEvents != null) {
    nextProps.pointerEvents = pointerEvents;
  }

  return nextProps;
}

function createSafeAreaProvider(target) {
  function SafeAreaProvider(props) {
    const React = resolveReact(target);
    return React.createElement(React.Fragment, null, props?.children ?? null);
  }

  SafeAreaProvider.displayName = 'SafeAreaProvider';
  return SafeAreaProvider;
}

function createSafeAreaView(target) {
  function SafeAreaView(props) {
    const React = resolveReact(target);
    return React.createElement(
      resolveViewType(target),
      buildSafeAreaViewProps(props),
      props?.children,
    );
  }

  SafeAreaView.displayName = 'SafeAreaView';
  return SafeAreaView;
}

function mergeRuntimeModule(existingModule, nextModule) {
  for (const [key, value] of Object.entries(nextModule)) {
    if (!(key in existingModule)) {
      existingModule[key] = value;
    }
  }

  existingModule.default = existingModule.default ?? existingModule;
  existingModule.__esModule = true;
  return existingModule;
}

function createSafeAreaModule(target = globalThis) {
  const moduleExports = {
    SafeAreaProvider: createSafeAreaProvider(target),
    SafeAreaView: createSafeAreaView(target),
    useSafeAreaInsets() {
      return ZERO_INSETS;
    },
  };

  moduleExports.default = moduleExports;
  moduleExports.__esModule = true;

  return moduleExports;
}

function installSafeAreaShim(target = globalThis) {
  const registry = ensureRuntimeShimRegistry(target);
  const existingModule = registry[MODULE_ID];
  const safeAreaModule = createSafeAreaModule(target);

  if (existingModule && typeof existingModule === 'object') {
    return mergeRuntimeModule(existingModule, safeAreaModule);
  }

  registry[MODULE_ID] = safeAreaModule;
  return safeAreaModule;
}

module.exports = installSafeAreaShim;
module.exports.install = installSafeAreaShim;
module.exports.applyRuntimeShim = installSafeAreaShim;
module.exports.createSafeAreaModule = createSafeAreaModule;
module.exports.ensureRuntimeShimRegistry = ensureRuntimeShimRegistry;
module.exports.MODULE_ID = MODULE_ID;
module.exports.RUNTIME_SHIM_REGISTRY_KEY = RUNTIME_SHIM_REGISTRY_KEY;

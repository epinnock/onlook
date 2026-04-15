const MODULE_ID = 'react-native-svg';
const RUNTIME_SHIM_REGISTRY_KEY = '__onlookShims';

function ensureRuntimeShimRegistry(target) {
  if (!target || typeof target !== 'object') {
    throw new TypeError('react-native-svg core shim requires an object target');
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

function mergeStyle(style, nextStyle) {
  if (!nextStyle || Object.keys(nextStyle).length === 0) {
    return style;
  }

  if (!style) {
    return nextStyle;
  }

  if (Array.isArray(style)) {
    return [...style, nextStyle];
  }

  return [style, nextStyle];
}

function buildContainerProps(props) {
  const {
    style,
    width,
    height,
    opacity,
    testID,
    nativeID,
    accessibilityLabel,
    accessibilityRole,
    pointerEvents,
  } = props || {};
  const nextStyle = {};
  const nextProps = {};

  if (width != null) {
    nextStyle.width = width;
  }

  if (height != null) {
    nextStyle.height = height;
  }

  if (opacity != null) {
    nextStyle.opacity = opacity;
  }

  const mergedStyle = mergeStyle(style, nextStyle);

  if (mergedStyle) {
    nextProps.style = mergedStyle;
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

function createContainerComponent(displayName, target) {
  function SvgContainer(props) {
    const React = resolveReact(target);
    return React.createElement(
      resolveViewType(target),
      buildContainerProps(props),
      props?.children,
    );
  }

  SvgContainer.displayName = displayName;
  return SvgContainer;
}

function createFragmentComponent(displayName, target) {
  function SvgFragment(props) {
    const React = resolveReact(target);
    return React.createElement(React.Fragment, null, props?.children ?? null);
  }

  SvgFragment.displayName = displayName;
  return SvgFragment;
}

function createNullComponent(displayName) {
  function SvgNull() {
    return null;
  }

  SvgNull.displayName = displayName;
  return SvgNull;
}

function mergeRuntimeModule(existingModule, nextModule) {
  for (const [key, value] of Object.entries(nextModule)) {
    if (!(key in existingModule)) {
      existingModule[key] = value;
    }
  }

  if (!('default' in existingModule) || existingModule.default == null) {
    existingModule.default = existingModule.Svg ?? nextModule.default;
  }

  existingModule.__esModule = true;
  return existingModule;
}

function createReactNativeSvgCoreModule(target = globalThis) {
  const Svg = createContainerComponent('Svg', target);
  const moduleExports = {
    Svg,
    G: createFragmentComponent('G', target),
    Defs: createFragmentComponent('Defs', target),
    ClipPath: createFragmentComponent('ClipPath', target),
    LinearGradient: createFragmentComponent('LinearGradient', target),
    RadialGradient: createFragmentComponent('RadialGradient', target),
    Mask: createFragmentComponent('Mask', target),
    Marker: createFragmentComponent('Marker', target),
    Pattern: createFragmentComponent('Pattern', target),
    Symbol: createFragmentComponent('Symbol', target),
    Use: createFragmentComponent('Use', target),
    Stop: createNullComponent('Stop'),
  };

  moduleExports.default = Svg;
  moduleExports.__esModule = true;

  return moduleExports;
}

function installReactNativeSvgCore(target = globalThis) {
  const registry = ensureRuntimeShimRegistry(target);
  const existingModule = registry[MODULE_ID];
  const coreModule = createReactNativeSvgCoreModule(target);

  if (existingModule && typeof existingModule === 'object') {
    return mergeRuntimeModule(existingModule, coreModule);
  }

  registry[MODULE_ID] = coreModule;
  return coreModule;
}

module.exports = installReactNativeSvgCore;
module.exports.install = installReactNativeSvgCore;
module.exports.applyRuntimeShim = installReactNativeSvgCore;
module.exports.createReactNativeSvgCoreModule = createReactNativeSvgCoreModule;
module.exports.ensureRuntimeShimRegistry = ensureRuntimeShimRegistry;
module.exports.mergeRuntimeModule = mergeRuntimeModule;
module.exports.MODULE_ID = MODULE_ID;
module.exports.RUNTIME_SHIM_REGISTRY_KEY = RUNTIME_SHIM_REGISTRY_KEY;

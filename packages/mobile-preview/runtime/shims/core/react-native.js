const { installStyleHelpers } = require('./style.js');

const MODULE_ID = 'react-native';
const RUNTIME_SHIM_REGISTRY_KEY = '__onlookShims';

function ensureRuntimeShimRegistry(target) {
  if (!target || (typeof target !== 'object' && typeof target !== 'function')) {
    throw new TypeError('react-native shim requires an object target');
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

function resolveTextType(target) {
  return target && target.Text ? target.Text : 'RCTText';
}

function resolveRawTextType(target) {
  return target && target.RawText ? target.RawText : 'RCTRawText';
}

function resolveRenderApp(target) {
  if (target && typeof target.renderApp === 'function') {
    return target.renderApp.bind(target);
  }

  if (target !== globalThis && typeof globalThis.renderApp === 'function') {
    return globalThis.renderApp.bind(globalThis);
  }

  return null;
}

function buildTextProps(props) {
  const nextProps = {};

  if (!props || typeof props !== 'object') {
    return nextProps;
  }

  for (const [key, value] of Object.entries(props)) {
    if (key !== 'children') {
      nextProps[key] = value;
    }
  }

  return nextProps;
}

function normalizeTextChildren(children, target) {
  const React = resolveReact(target);
  const rawTextType = resolveRawTextType(target);
  const normalizedChildren = Array.isArray(children) ? children : [children];

  return normalizedChildren.map((child, index) => {
    if (typeof child === 'string' || typeof child === 'number') {
      return React.createElement(rawTextType, { key: index, text: String(child) });
    }

    return child;
  });
}

function createTextComponent(target) {
  function Text(props) {
    if (target && typeof target.TextC === 'function') {
      return target.TextC(props || {});
    }

    const React = resolveReact(target);
    return React.createElement(
      resolveTextType(target),
      buildTextProps(props),
      ...normalizeTextChildren(props?.children, target),
    );
  }

  Text.displayName = 'Text';
  return Text;
}

function buildPassthroughViewProps(props) {
  const {
    children,
    onPress,
    onPressIn,
    onPressOut,
    onLongPress,
    activeOpacity,
    underlayColor,
    ...rest
  } = props || {};

  return {
    children,
    props: rest,
  };
}

// Fabric only knows the host view/text types. Higher-level RN primitives need
// to collapse down to the preview View host or the subtree is dropped.
function createPassthroughViewComponent(displayName, target) {
  function PassthroughView(props) {
    const React = resolveReact(target);
    const nextProps = buildPassthroughViewProps(props);
    return React.createElement(resolveViewType(target), nextProps.props, nextProps.children);
  }

  PassthroughView.displayName = displayName;
  return PassthroughView;
}

function createNullComponent(displayName) {
  function NullComponent() {
    return null;
  }

  NullComponent.displayName = displayName;
  return NullComponent;
}

function createStyleSheet(target) {
  const styleHelpers = installStyleHelpers(target);

  return {
    create(styles) {
      return styleHelpers.createStyleSheet(styles);
    },
    compose(a, b) {
      return styleHelpers.composeStyles(a, b);
    },
    flatten(style) {
      return styleHelpers.flattenStyle(style);
    },
  };
}

function createPlatformModule() {
  return {
    OS: 'ios',
    select(options) {
      return options && (options.ios ?? options.native ?? options.default);
    },
  };
}

function createDimensionsModule() {
  return {
    get() {
      return {
        width: 390,
        height: 844,
        scale: 3,
        fontScale: 1,
      };
    },
  };
}

function createAppRegistry(target) {
  return {
    registerComponent(appKey, componentProvider) {
      if (appKey !== 'main') {
        return;
      }

      const Comp = typeof componentProvider === 'function' ? componentProvider() : null;
      if (!Comp) {
        return;
      }

      const renderApp = resolveRenderApp(target);
      if (typeof renderApp === 'function') {
        // Signal to the per-push IIFE wrapper that an AppRegistry-style
        // entry successfully triggered renderApp, so its default-export
        // fallback path doesn't then throw with a misleading "entry did
        // not call AppRegistry" error. See services/mobile-preview/
        // bundler/wrap-eval-bundle.ts — it resets this flag at the top
        // of each push and reads it at the tail.
        target.__onlookAppRegistered = true;
        renderApp(resolveReact(target).createElement(Comp, null));
      }
    },
    runApplication() {
      // No-op: registerComponent already triggered the mount above.
    },
  };
}

function mergeRuntimeModule(existingModule, nextModule) {
  for (const [key, value] of Object.entries(nextModule)) {
    if (!(key in existingModule)) {
      existingModule[key] = value;
    }
  }

  if (existingModule.default == null || existingModule.default === nextModule.default) {
    existingModule.default = existingModule;
  }

  existingModule.__esModule = true;
  return existingModule;
}

function createReactNativeModule(target = globalThis) {
  const React = resolveReact(target);
  const moduleExports = {
    View: resolveViewType(target),
    Text: createTextComponent(target),
    TextInput: createPassthroughViewComponent('TextInput', target),
    Image: createPassthroughViewComponent('Image', target),
    ScrollView: createPassthroughViewComponent('ScrollView', target),
    SafeAreaView: createPassthroughViewComponent('SafeAreaView', target),
    Pressable: createPassthroughViewComponent('Pressable', target),
    TouchableOpacity: createPassthroughViewComponent('TouchableOpacity', target),
    TouchableHighlight: createPassthroughViewComponent('TouchableHighlight', target),
    TouchableWithoutFeedback: createPassthroughViewComponent(
      'TouchableWithoutFeedback',
      target,
    ),
    StatusBar: createNullComponent('StatusBar'),
    RawText: resolveRawTextType(target),
    Fragment: React.Fragment,
    StyleSheet: createStyleSheet(target),
    Platform: createPlatformModule(),
    Dimensions: createDimensionsModule(),
    Alert: {
      alert() {},
    },
    AppRegistry: createAppRegistry(target),
  };

  moduleExports.default = moduleExports;
  moduleExports.__esModule = true;

  return moduleExports;
}

function installReactNativeShim(target = globalThis) {
  const registry = ensureRuntimeShimRegistry(target);
  const existingModule = registry[MODULE_ID];
  const reactNativeModule = createReactNativeModule(target);

  if (existingModule && typeof existingModule === 'object') {
    return mergeRuntimeModule(existingModule, reactNativeModule);
  }

  registry[MODULE_ID] = reactNativeModule;
  return reactNativeModule;
}

const reactNativeShim = {
  id: MODULE_ID,
  install: installReactNativeShim,
  applyRuntimeShim: installReactNativeShim,
  createReactNativeModule,
  ensureRuntimeShimRegistry,
  mergeRuntimeModule,
  MODULE_ID,
  RUNTIME_SHIM_REGISTRY_KEY,
};

reactNativeShim.default = reactNativeShim;
reactNativeShim.__esModule = true;

module.exports = reactNativeShim;

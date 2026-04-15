const MODULE_ID = 'react-native-screens';
const RUNTIME_SHIM_REGISTRY_KEY = '__onlookShims';
const TRANSITION_PROGRESS = Object.freeze({ progress: 1, closing: 0, goingForward: 1 });

function ensureRuntimeShimRegistry(target) {
  if (!target || typeof target !== 'object') {
    throw new TypeError('react-native-screens shim requires an object target');
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

function buildViewProps(props) {
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

function createViewComponent(displayName, target) {
  function ReactNativeScreensView(props) {
    const React = resolveReact(target);
    return React.createElement(
      resolveViewType(target),
      buildViewProps(props),
      props?.children,
    );
  }

  ReactNativeScreensView.displayName = displayName;
  return ReactNativeScreensView;
}

function createFragmentComponent(displayName, target) {
  function ReactNativeScreensFragment(props) {
    const React = resolveReact(target);
    return React.createElement(React.Fragment, null, props?.children ?? null);
  }

  ReactNativeScreensFragment.displayName = displayName;
  return ReactNativeScreensFragment;
}

function createNullComponent(displayName) {
  function ReactNativeScreensNull() {
    return null;
  }

  ReactNativeScreensNull.displayName = displayName;
  return ReactNativeScreensNull;
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

function createReactNativeScreensModule(target = globalThis) {
  const React = resolveReact(target);
  const runtimeState = {
    freezeEnabled: false,
    screensEnabled: true,
  };

  const Screen = createViewComponent('Screen', target);
  const ScreenContainer = createViewComponent('ScreenContainer', target);
  const ScreenStack = createViewComponent('ScreenStack', target);
  const ScreenStackHeaderSubview = createFragmentComponent('ScreenStackHeaderSubview', target);
  const ScreenStackHeaderConfig = createFragmentComponent('ScreenStackHeaderConfig', target);
  const FullWindowOverlay = createFragmentComponent('FullWindowOverlay', target);
  const SearchBar = createNullComponent('SearchBar');

  const moduleExports = {
    Screen,
    NativeScreen: Screen,
    InnerScreen: Screen,
    ScreenContainer,
    NativeScreenContainer: ScreenContainer,
    NativeScreenNavigationContainer: ScreenContainer,
    ScreenStack,
    ScreenStackHeaderConfig,
    ScreenStackHeaderSubview,
    ScreenStackHeaderLeftView: ScreenStackHeaderSubview,
    ScreenStackHeaderCenterView: ScreenStackHeaderSubview,
    ScreenStackHeaderRightView: ScreenStackHeaderSubview,
    ScreenStackHeaderSearchBarView: ScreenStackHeaderSubview,
    ScreenStackHeaderBackButtonImage: createNullComponent('ScreenStackHeaderBackButtonImage'),
    SearchBar,
    NativeSearchBar: SearchBar,
    NativeSearchBarCommands: {
      blur() {},
      clearText() {},
      focus() {},
      setText() {},
      toggleCancelButton() {},
    },
    FullWindowOverlay,
    NativeScreensModule: {},
    ScreenContext: React.createContext(null),
    GHContext: React.createContext(null),
    enableScreens(shouldEnableScreens = true) {
      runtimeState.screensEnabled = shouldEnableScreens !== false;
      return runtimeState.screensEnabled;
    },
    enableFreeze(shouldEnableReactFreeze = true) {
      runtimeState.freezeEnabled = shouldEnableReactFreeze !== false;
      return runtimeState.freezeEnabled;
    },
    screensEnabled() {
      return runtimeState.screensEnabled;
    },
    freezeEnabled() {
      return runtimeState.freezeEnabled;
    },
    shouldUseActivityState: true,
    isSearchBarAvailableForCurrentPlatform() {
      return false;
    },
    isNewBackTitleImplementation() {
      return false;
    },
    executeNativeBackPress() {
      return false;
    },
    useTransitionProgress() {
      return TRANSITION_PROGRESS;
    },
  };

  moduleExports.default = moduleExports;
  moduleExports.__esModule = true;

  return moduleExports;
}

function installReactNativeScreens(target = globalThis) {
  const registry = ensureRuntimeShimRegistry(target);
  const existingModule = registry[MODULE_ID];
  const reactNativeScreensModule = createReactNativeScreensModule(target);

  if (existingModule && typeof existingModule === 'object') {
    return mergeRuntimeModule(existingModule, reactNativeScreensModule);
  }

  registry[MODULE_ID] = reactNativeScreensModule;
  return reactNativeScreensModule;
}

module.exports = installReactNativeScreens;
module.exports.install = installReactNativeScreens;
module.exports.applyRuntimeShim = installReactNativeScreens;
module.exports.createReactNativeScreensModule = createReactNativeScreensModule;
module.exports.ensureRuntimeShimRegistry = ensureRuntimeShimRegistry;
module.exports.mergeRuntimeModule = mergeRuntimeModule;
module.exports.MODULE_ID = MODULE_ID;
module.exports.RUNTIME_SHIM_REGISTRY_KEY = RUNTIME_SHIM_REGISTRY_KEY;

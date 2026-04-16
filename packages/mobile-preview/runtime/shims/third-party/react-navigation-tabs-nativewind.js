const MODULE_ID = '@react-navigation/bottom-tabs';
const RUNTIME_SHIM_REGISTRY_KEY = '__onlookShims';

function ensureRuntimeShimRegistry(target) {
  if (!target || typeof target !== 'object') {
    throw new TypeError('@react-navigation/bottom-tabs shim requires an object target');
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

function mergeClassNames(...values) {
  const tokens = [];

  for (const value of values) {
    if (typeof value !== 'string') {
      continue;
    }

    const trimmed = value.trim();

    if (trimmed) {
      tokens.push(trimmed);
    }
  }

  return tokens.length > 0 ? tokens.join(' ') : undefined;
}

function mergeStyles(...values) {
  const styles = values.filter(Boolean);

  if (styles.length === 0) {
    return undefined;
  }

  if (styles.length === 1) {
    return styles[0];
  }

  return styles;
}

function buildViewProps(props, compatOptions) {
  const {
    style,
    className,
    testID,
    nativeID,
    accessibilityLabel,
    accessibilityRole,
    pointerEvents,
  } = props || {};
  const nextProps = {};
  const nextStyle = mergeStyles(
    style,
    compatOptions?.sceneStyle,
    compatOptions?.sceneContainerStyle,
    compatOptions?.contentStyle,
  );
  const nextClassName = mergeClassNames(
    className,
    compatOptions?.className,
    compatOptions?.sceneClassName,
    compatOptions?.sceneContainerClassName,
    compatOptions?.contentClassName,
  );

  if (nextStyle) {
    nextProps.style = nextStyle;
  }

  if (nextClassName) {
    nextProps.className = nextClassName;
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

function createNavigationHelpers(route) {
  return {
    emit() {},
    canGoBack() {
      return false;
    },
    dispatch() {},
    getParent() {
      return undefined;
    },
    goBack() {},
    isFocused() {
      return true;
    },
    navigate() {},
    jumpTo() {},
    popToTop() {},
    replace() {},
    reset() {},
    setOptions() {},
    setParams() {},
    route,
  };
}

function isTabScreenElement(element) {
  return Boolean(
    element &&
      typeof element === 'object' &&
      element.type &&
      element.type.__onlookBottomTabScreen === true,
  );
}

function resolveScreenOptions(rawOptions, route, navigation) {
  if (typeof rawOptions === 'function') {
    return rawOptions({ route, navigation }) ?? {};
  }

  if (rawOptions && typeof rawOptions === 'object') {
    return rawOptions;
  }

  return {};
}

function selectTabScreen(children) {
  const queue = [];
  const initialItems = Array.isArray(children) ? children : [children];

  for (const item of initialItems) {
    if (item !== undefined) {
      queue.push(item);
    }
  }

  while (queue.length > 0) {
    const current = queue.shift();

    if (isTabScreenElement(current)) {
      return current;
    }

    if (Array.isArray(current)) {
      for (const nested of current) {
        queue.push(nested);
      }
      continue;
    }

    if (current && typeof current === 'object' && current.props && current.props.children !== undefined) {
      queue.push(current.props.children);
    }
  }

  return null;
}

function renderScreenContent(screenElement, route, navigation, target) {
  const React = resolveReact(target);
  const { children, component, getComponent } = screenElement.props || {};

  if (typeof children === 'function') {
    return children({ route, navigation });
  }

  if (children != null) {
    return children;
  }

  if (typeof component === 'function') {
    return React.createElement(component, { navigation, route });
  }

  if (typeof getComponent === 'function') {
    const resolvedComponent = getComponent();

    if (typeof resolvedComponent === 'function') {
      return React.createElement(resolvedComponent, { navigation, route });
    }
  }

  return null;
}

function createViewPassthrough(displayName, target) {
  function ViewPassthrough(props) {
    const React = resolveReact(target);
    return React.createElement(
      resolveViewType(target),
      buildViewProps(props),
      props?.children ?? null,
    );
  }

  ViewPassthrough.displayName = displayName;
  return ViewPassthrough;
}

function createBottomTabNavigator(target) {
  const React = resolveReact(target);

  function Screen() {
    return null;
  }

  Screen.displayName = 'BottomTabScreen';
  Screen.__onlookBottomTabScreen = true;

  function Navigator(props) {
    const selectedScreen = selectTabScreen(props?.children);

    if (!selectedScreen) {
      return React.createElement(
        resolveViewType(target),
        buildViewProps(props),
        null,
      );
    }

    const route = {
      key: `${selectedScreen.props?.name ?? 'tab'}:preview`,
      name: selectedScreen.props?.name ?? 'tab',
      params: selectedScreen.props?.initialParams ?? {},
    };
    const navigation = createNavigationHelpers(route);
    const navigatorOptions = resolveScreenOptions(
      props?.screenOptions,
      route,
      navigation,
    );
    const screenOptions = resolveScreenOptions(
      selectedScreen.props?.options,
      route,
      navigation,
    );

    return React.createElement(
      resolveViewType(target),
      buildViewProps(props, {
        ...navigatorOptions,
        ...screenOptions,
      }),
      renderScreenContent(selectedScreen, route, navigation, target),
    );
  }

  Navigator.displayName = 'BottomTabNavigator';

  return {
    Navigator,
    Screen,
  };
}

function createReactNavigationBottomTabsModule(target = globalThis) {
  const React = resolveReact(target);
  const BottomTabBarHeightContext = React.createContext(0);
  const moduleExports = {
    createBottomTabNavigator() {
      return createBottomTabNavigator(target);
    },
    BottomTabBar: createViewPassthrough('BottomTabBar', target),
    BottomTabView: createViewPassthrough('BottomTabView', target),
    BottomTabBarHeightContext,
    useBottomTabBarHeight() {
      return 0;
    },
  };

  moduleExports.default = moduleExports;
  moduleExports.__esModule = true;

  return moduleExports;
}

function installReactNavigationBottomTabsShim(target = globalThis) {
  const registry = ensureRuntimeShimRegistry(target);
  const existingModule = registry[MODULE_ID];
  const nextModule = createReactNavigationBottomTabsModule(target);

  if (existingModule && typeof existingModule === 'object') {
    return mergeRuntimeModule(existingModule, nextModule);
  }

  registry[MODULE_ID] = nextModule;
  return nextModule;
}

module.exports = installReactNavigationBottomTabsShim;
module.exports.install = installReactNavigationBottomTabsShim;
module.exports.applyRuntimeShim = installReactNavigationBottomTabsShim;
module.exports.createReactNavigationBottomTabsModule =
  createReactNavigationBottomTabsModule;
module.exports.createBottomTabNavigator = createBottomTabNavigator;
module.exports.ensureRuntimeShimRegistry = ensureRuntimeShimRegistry;
module.exports.mergeRuntimeModule = mergeRuntimeModule;
module.exports.MODULE_ID = MODULE_ID;
module.exports.RUNTIME_SHIM_REGISTRY_KEY = RUNTIME_SHIM_REGISTRY_KEY;

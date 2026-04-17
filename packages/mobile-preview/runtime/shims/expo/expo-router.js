const MODULE_ID = 'expo-router';
const RUNTIME_SHIM_REGISTRY_KEY = '__onlookShims';

function ensureRuntimeShimRegistry(target) {
  if (!target || typeof target !== 'object') {
    throw new TypeError('expo-router shim requires an object target');
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

function resolveTextType(target) {
  return target && target.TextC ? target.TextC : 'Text';
}

function buildLinkProps(props) {
  const {
    style,
    testID,
    nativeID,
    accessibilityLabel,
    accessibilityRole,
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

  return nextProps;
}

function createLink(target) {
  function Link(props) {
    const React = resolveReact(target);

    return React.createElement(
      resolveTextType(target),
      buildLinkProps(props),
      props?.children,
    );
  }

  Link.displayName = 'Link';
  return Link;
}

function createFragmentPassthroughComponent(displayName, target) {
  function FragmentPassthroughComponent(props) {
    const React = resolveReact(target);
    return React.createElement(React.Fragment, null, props?.children ?? null);
  }

  FragmentPassthroughComponent.displayName = displayName;
  return FragmentPassthroughComponent;
}

function createRedirect() {
  function Redirect() {
    return null;
  }

  Redirect.displayName = 'Redirect';
  return Redirect;
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

function createExpoRouterModule(target = globalThis) {
  const moduleExports = {
    Link: createLink(target),
    Redirect: createRedirect(),
    Slot: createFragmentPassthroughComponent('Slot', target),
    Stack: createFragmentPassthroughComponent('Stack', target),
    Tabs: createFragmentPassthroughComponent('Tabs', target),
    useRouter() {
      return {
        push() {},
        replace() {},
        back() {},
      };
    },
    useLocalSearchParams() {
      return {};
    },
  };

  moduleExports.default = moduleExports;
  moduleExports.__esModule = true;

  return moduleExports;
}

function installExpoRouterShim(target = globalThis) {
  const registry = ensureRuntimeShimRegistry(target);
  const existingModule = registry[MODULE_ID];
  const expoRouterModule = createExpoRouterModule(target);

  if (existingModule && typeof existingModule === 'object') {
    return mergeRuntimeModule(existingModule, expoRouterModule);
  }

  registry[MODULE_ID] = expoRouterModule;
  return expoRouterModule;
}

module.exports = installExpoRouterShim;
module.exports.install = installExpoRouterShim;
module.exports.applyRuntimeShim = installExpoRouterShim;
module.exports.createExpoRouterModule = createExpoRouterModule;
module.exports.ensureRuntimeShimRegistry = ensureRuntimeShimRegistry;
module.exports.MODULE_ID = MODULE_ID;
module.exports.RUNTIME_SHIM_REGISTRY_KEY = RUNTIME_SHIM_REGISTRY_KEY;

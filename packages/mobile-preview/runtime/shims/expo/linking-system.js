const SHIM_ID = 'linking-system';
const RUNTIME_SHIM_REGISTRY_KEY = '__onlookShims';
const RUNTIME_STATE_KEY = '__onlookExpoLinkingSystemState';
const DEFAULT_LINKING_SCHEME = 'onlook-preview';
const EXPO_LINKING_MODULE_ID = 'expo-linking';
const EXPO_SYSTEM_UI_MODULE_ID = 'expo-system-ui';
const EXPO_SPLASH_SCREEN_MODULE_ID = 'expo-splash-screen';
const MODULE_IDS = Object.freeze({
  expoLinking: EXPO_LINKING_MODULE_ID,
  expoSplashScreen: EXPO_SPLASH_SCREEN_MODULE_ID,
  expoSystemUI: EXPO_SYSTEM_UI_MODULE_ID,
});

function ensureObjectTarget(target) {
  if (!target || typeof target !== 'object') {
    throw new TypeError('linking-system shim requires an object target');
  }

  return target;
}

function ensureRuntimeShimRegistry(target) {
  const normalizedTarget = ensureObjectTarget(target);

  if (
    !normalizedTarget[RUNTIME_SHIM_REGISTRY_KEY] ||
    typeof normalizedTarget[RUNTIME_SHIM_REGISTRY_KEY] !== 'object'
  ) {
    normalizedTarget[RUNTIME_SHIM_REGISTRY_KEY] = {};
  }

  return normalizedTarget[RUNTIME_SHIM_REGISTRY_KEY];
}

function ensureRuntimeState(target) {
  const normalizedTarget = ensureObjectTarget(target);

  if (
    !normalizedTarget[RUNTIME_STATE_KEY] ||
    typeof normalizedTarget[RUNTIME_STATE_KEY] !== 'object'
  ) {
    normalizedTarget[RUNTIME_STATE_KEY] = {
      backgroundColor: null,
      initialURL:
        typeof normalizedTarget.location?.href === 'string'
          ? normalizedTarget.location.href
          : null,
      splashScreenOptions: null,
      splashScreenPreventedAutoHide: false,
    };
  }

  return normalizedTarget[RUNTIME_STATE_KEY];
}

function buildQueryString(queryParams) {
  if (!queryParams || typeof queryParams !== 'object') {
    return '';
  }

  const searchParams = new URLSearchParams();

  for (const [key, value] of Object.entries(queryParams)) {
    if (value == null) {
      continue;
    }

    if (Array.isArray(value)) {
      for (const item of value) {
        if (item != null) {
          searchParams.append(key, String(item));
        }
      }

      continue;
    }

    searchParams.append(key, String(value));
  }

  const query = searchParams.toString();
  return query ? `?${query}` : '';
}

function collectQueryParams(searchParams) {
  const queryParams = {};

  for (const key of searchParams.keys()) {
    const values = searchParams.getAll(key);

    if (values.length === 0) {
      continue;
    }

    queryParams[key] = values.length === 1 ? values[0] : values;
  }

  return Object.keys(queryParams).length > 0 ? queryParams : null;
}

function normalizeLinkingPath(path) {
  if (typeof path !== 'string' || path.length === 0) {
    return '';
  }

  return path.replace(/^\/+/, '');
}

function parseURL(url) {
  if (typeof url !== 'string' || url.length === 0) {
    return {
      hostname: null,
      path: null,
      queryParams: null,
      scheme: null,
    };
  }

  try {
    const parsedUrl = new URL(url);
    const scheme = parsedUrl.protocol.replace(/:$/, '') || null;
    const pathname = parsedUrl.pathname.replace(/^\/+/, '');
    const isHttpLike = scheme === 'http' || scheme === 'https';
    const pathSegments = [];

    if (!isHttpLike && parsedUrl.hostname) {
      pathSegments.push(parsedUrl.hostname);
    }

    if (pathname) {
      pathSegments.push(pathname);
    }

    return {
      hostname: isHttpLike ? parsedUrl.hostname || null : null,
      path: pathSegments.join('/') || null,
      queryParams: collectQueryParams(parsedUrl.searchParams),
      scheme,
    };
  } catch (_) {
    return {
      hostname: null,
      path: null,
      queryParams: null,
      scheme: null,
    };
  }
}

function mergeRuntimeModule(existingModule, nextModule) {
  for (const [key, value] of Object.entries(nextModule)) {
    if (!(key in existingModule)) {
      existingModule[key] = value;
    }
  }

  if (
    !('default' in existingModule) ||
    existingModule.default == null ||
    existingModule.default === nextModule.default
  ) {
    existingModule.default = existingModule;
  }

  existingModule.__esModule = true;
  return existingModule;
}

function installRuntimeModule(target, moduleId, createModule) {
  const registry = ensureRuntimeShimRegistry(target);
  const existingModule = registry[moduleId];
  const nextModule = createModule(target);

  if (existingModule && typeof existingModule === 'object') {
    return mergeRuntimeModule(existingModule, nextModule);
  }

  registry[moduleId] = nextModule;
  return nextModule;
}

function createExpoLinkingModule(target = globalThis) {
  const runtimeState = ensureRuntimeState(target);

  const moduleExports = {
    addEventListener() {
      return {
        remove() {},
      };
    },
    canOpenURL(url) {
      return Promise.resolve(typeof url === 'string' && url.length > 0);
    },
    collectManifestSchemes() {
      return [moduleExports.resolveScheme()];
    },
    createURL(path = '', options = {}) {
      const normalizedPath = normalizeLinkingPath(path);
      const query = buildQueryString(options.queryParams);
      const scheme =
        typeof options.scheme === 'string' && options.scheme.length > 0
          ? options.scheme
          : DEFAULT_LINKING_SCHEME;
      const slashes = options.isTripleSlashed ? ':///' : '://';

      if (!normalizedPath) {
        return `${scheme}${slashes}${query}`;
      }

      return `${scheme}${slashes}${normalizedPath}${query}`;
    },
    getInitialURL() {
      return Promise.resolve(runtimeState.initialURL);
    },
    getLinkingURL() {
      return runtimeState.initialURL;
    },
    hasConstantsManifest() {
      return false;
    },
    hasCustomScheme() {
      return true;
    },
    openSettings() {
      return Promise.resolve();
    },
    openURL(url) {
      return Promise.resolve(typeof url === 'string' && url.length > 0);
    },
    parse: parseURL,
    parseInitialURLAsync() {
      return Promise.resolve(parseURL(runtimeState.initialURL));
    },
    resolveScheme(options = {}) {
      return typeof options.scheme === 'string' && options.scheme.length > 0
        ? options.scheme
        : DEFAULT_LINKING_SCHEME;
    },
    sendIntent() {
      return Promise.resolve();
    },
    useLinkingURL() {
      return runtimeState.initialURL;
    },
    useURL() {
      return runtimeState.initialURL;
    },
  };

  moduleExports.default = moduleExports;
  moduleExports.__esModule = true;

  return moduleExports;
}

function createExpoSystemUIModule(target = globalThis) {
  const runtimeState = ensureRuntimeState(target);
  const moduleExports = {
    getBackgroundColorAsync() {
      return Promise.resolve(runtimeState.backgroundColor);
    },
    setBackgroundColorAsync(color) {
      runtimeState.backgroundColor = color ?? null;
      return Promise.resolve();
    },
  };

  moduleExports.default = moduleExports;
  moduleExports.__esModule = true;

  return moduleExports;
}

function createExpoSplashScreenModule(target = globalThis) {
  const runtimeState = ensureRuntimeState(target);
  const moduleExports = {
    hide() {
      runtimeState.splashScreenPreventedAutoHide = false;
    },
    hideAsync() {
      runtimeState.splashScreenPreventedAutoHide = false;
      return Promise.resolve();
    },
    preventAutoHideAsync() {
      const shouldPreventAutoHide = !runtimeState.splashScreenPreventedAutoHide;
      runtimeState.splashScreenPreventedAutoHide = true;
      return Promise.resolve(shouldPreventAutoHide);
    },
    setOptions(options) {
      runtimeState.splashScreenOptions =
        options && typeof options === 'object' ? { ...options } : null;
    },
  };

  moduleExports.default = moduleExports;
  moduleExports.__esModule = true;

  return moduleExports;
}

function installExpoLinkingSystemShims(target = globalThis) {
  ensureObjectTarget(target);

  return {
    expoLinking: installRuntimeModule(
      target,
      EXPO_LINKING_MODULE_ID,
      createExpoLinkingModule,
    ),
    expoSplashScreen: installRuntimeModule(
      target,
      EXPO_SPLASH_SCREEN_MODULE_ID,
      createExpoSplashScreenModule,
    ),
    expoSystemUI: installRuntimeModule(
      target,
      EXPO_SYSTEM_UI_MODULE_ID,
      createExpoSystemUIModule,
    ),
  };
}

module.exports = installExpoLinkingSystemShims;
module.exports.install = installExpoLinkingSystemShims;
module.exports.applyRuntimeShim = installExpoLinkingSystemShims;
module.exports.createExpoLinkingModule = createExpoLinkingModule;
module.exports.createExpoSplashScreenModule = createExpoSplashScreenModule;
module.exports.createExpoSystemUIModule = createExpoSystemUIModule;
module.exports.ensureRuntimeShimRegistry = ensureRuntimeShimRegistry;
module.exports.ensureRuntimeState = ensureRuntimeState;
module.exports.mergeRuntimeModule = mergeRuntimeModule;
module.exports.EXPO_LINKING_MODULE_ID = EXPO_LINKING_MODULE_ID;
module.exports.EXPO_SPLASH_SCREEN_MODULE_ID = EXPO_SPLASH_SCREEN_MODULE_ID;
module.exports.EXPO_SYSTEM_UI_MODULE_ID = EXPO_SYSTEM_UI_MODULE_ID;
module.exports.MODULE_IDS = MODULE_IDS;
module.exports.RUNTIME_SHIM_REGISTRY_KEY = RUNTIME_SHIM_REGISTRY_KEY;
module.exports.RUNTIME_STATE_KEY = RUNTIME_STATE_KEY;
module.exports.SHIM_ID = SHIM_ID;

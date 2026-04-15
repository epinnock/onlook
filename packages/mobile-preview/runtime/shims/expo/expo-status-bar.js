const MODULE_ID = 'expo-status-bar';
const RUNTIME_SHIM_REGISTRY_KEY = '__onlookShims';

function ensureRuntimeShimRegistry(target) {
  if (!target || typeof target !== 'object') {
    throw new TypeError('expo-status-bar shim requires an object target');
  }

  if (!target[RUNTIME_SHIM_REGISTRY_KEY] || typeof target[RUNTIME_SHIM_REGISTRY_KEY] !== 'object') {
    target[RUNTIME_SHIM_REGISTRY_KEY] = {};
  }

  return target[RUNTIME_SHIM_REGISTRY_KEY];
}

function createNoop() {
  return undefined;
}

function createExpoStatusBarModule() {
  function StatusBar() {
    return null;
  }

  StatusBar.displayName = 'ExpoStatusBar';

  const moduleExports = {
    StatusBar,
    setStatusBarStyle: createNoop,
    setStatusBarHidden: createNoop,
    setStatusBarBackgroundColor: createNoop,
    setStatusBarTranslucent: createNoop,
  };

  moduleExports.default = StatusBar;
  moduleExports.__esModule = true;

  return moduleExports;
}

function mergeRuntimeModule(existingModule, nextModule) {
  for (const [key, value] of Object.entries(nextModule)) {
    if (key === 'default') {
      continue;
    }

    if (!(key in existingModule)) {
      existingModule[key] = value;
    }
  }

  existingModule.default = existingModule.StatusBar ?? existingModule.default ?? nextModule.default;
  existingModule.__esModule = true;
  return existingModule;
}

function installExpoStatusBarShim(target = globalThis) {
  const registry = ensureRuntimeShimRegistry(target);
  const existingModule = registry[MODULE_ID];
  const nextModule = createExpoStatusBarModule();

  if (existingModule && typeof existingModule === 'object') {
    return mergeRuntimeModule(existingModule, nextModule);
  }

  registry[MODULE_ID] = nextModule;
  return nextModule;
}

module.exports = installExpoStatusBarShim;
module.exports.install = installExpoStatusBarShim;
module.exports.applyRuntimeShim = installExpoStatusBarShim;
module.exports.createExpoStatusBarModule = createExpoStatusBarModule;
module.exports.ensureRuntimeShimRegistry = ensureRuntimeShimRegistry;
module.exports.mergeRuntimeModule = mergeRuntimeModule;
module.exports.MODULE_ID = MODULE_ID;
module.exports.RUNTIME_SHIM_REGISTRY_KEY = RUNTIME_SHIM_REGISTRY_KEY;

const MODULE_ID = 'onlook-preload-script.js';
const RUNTIME_SHIM_REGISTRY_KEY = '__onlookShims';

function ensureRuntimeShimRegistry(target) {
  if (!target || typeof target !== 'object') {
    throw new TypeError('onlook-preload-script shim requires an object target');
  }

  if (!target[RUNTIME_SHIM_REGISTRY_KEY] || typeof target[RUNTIME_SHIM_REGISTRY_KEY] !== 'object') {
    target[RUNTIME_SHIM_REGISTRY_KEY] = {};
  }

  return target[RUNTIME_SHIM_REGISTRY_KEY];
}

function createOnlookPreloadScriptModule() {
  return {};
}

function installOnlookPreloadScriptShim(target = globalThis) {
  const registry = ensureRuntimeShimRegistry(target);
  const existingModule = registry[MODULE_ID];

  if (existingModule && typeof existingModule === 'object') {
    return existingModule;
  }

  const moduleExports = createOnlookPreloadScriptModule();
  registry[MODULE_ID] = moduleExports;
  return moduleExports;
}

module.exports = installOnlookPreloadScriptShim;
module.exports.install = installOnlookPreloadScriptShim;
module.exports.applyRuntimeShim = installOnlookPreloadScriptShim;
module.exports.createOnlookPreloadScriptModule = createOnlookPreloadScriptModule;
module.exports.ensureRuntimeShimRegistry = ensureRuntimeShimRegistry;
module.exports.MODULE_ID = MODULE_ID;
module.exports.RUNTIME_SHIM_REGISTRY_KEY = RUNTIME_SHIM_REGISTRY_KEY;

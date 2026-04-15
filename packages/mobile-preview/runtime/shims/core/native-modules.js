const SHIM_ID = 'onlook-native-modules-bridge';
const REACT_NATIVE_MODULE_ID = 'react-native';
const RUNTIME_SHIM_REGISTRY_KEY = '__onlookShims';
const NATIVE_MODULE_BRIDGE_GLOBAL_KEY = '__onlookNativeModuleBridge';

function ensureBridgeTarget(target) {
  if (!target || (typeof target !== 'object' && typeof target !== 'function')) {
    throw new TypeError('native-modules shim requires an object target');
  }

  return target;
}

function ensureRuntimeShimRegistry(target) {
  const normalizedTarget = ensureBridgeTarget(target);

  if (
    !normalizedTarget[RUNTIME_SHIM_REGISTRY_KEY] ||
    typeof normalizedTarget[RUNTIME_SHIM_REGISTRY_KEY] !== 'object'
  ) {
    normalizedTarget[RUNTIME_SHIM_REGISTRY_KEY] = {};
  }

  return normalizedTarget[RUNTIME_SHIM_REGISTRY_KEY];
}

function resolveModuleFromSource(source, name) {
  if (!source) {
    return null;
  }

  try {
    if (typeof source === 'function') {
      return source(name) ?? null;
    }

    if (typeof source === 'object') {
      return source[name] ?? null;
    }
  } catch (_) {
    return null;
  }

  return null;
}

function getModuleSourceKeys(source) {
  if (!source || typeof source !== 'object') {
    return [];
  }

  return Object.keys(source);
}

function normalizeModuleName(name) {
  return typeof name === 'string' && name.length > 0 ? name : null;
}

function resolveNativeModule(target, name) {
  const moduleName = normalizeModuleName(name);

  if (!moduleName) {
    return null;
  }

  return (
    resolveModuleFromSource(target.nativeModuleProxy, moduleName) ??
    resolveModuleFromSource(target.__turboModuleProxy, moduleName)
  );
}

function resolveTurboModule(target, name) {
  const moduleName = normalizeModuleName(name);

  if (!moduleName) {
    return null;
  }

  return (
    resolveModuleFromSource(target.__turboModuleProxy, moduleName) ??
    resolveModuleFromSource(target.nativeModuleProxy, moduleName)
  );
}

function createNativeModulesProxy(target) {
  return new Proxy(
    {},
    {
      get(_unusedTarget, property) {
        if (typeof property !== 'string') {
          return undefined;
        }

        return resolveNativeModule(target, property);
      },
      getOwnPropertyDescriptor(_unusedTarget, property) {
        if (typeof property !== 'string') {
          return undefined;
        }

        const value = resolveNativeModule(target, property);

        if (value == null) {
          return undefined;
        }

        return {
          configurable: true,
          enumerable: true,
          value,
        };
      },
      has(_unusedTarget, property) {
        if (typeof property !== 'string') {
          return false;
        }

        return resolveNativeModule(target, property) != null;
      },
      ownKeys() {
        return Array.from(
          new Set([
            ...getModuleSourceKeys(target.nativeModuleProxy),
            ...getModuleSourceKeys(target.__turboModuleProxy),
          ]),
        );
      },
    },
  );
}

function createTurboModuleRegistry(target) {
  return {
    get(name) {
      return resolveTurboModule(target, name);
    },
    getEnforcing(name) {
      const module = resolveTurboModule(target, name);

      if (module == null) {
        throw new Error(`TurboModule "${name}" not found`);
      }

      return module;
    },
  };
}

function createNativeModuleBridge(target) {
  return {
    NativeModules: createNativeModulesProxy(target),
    TurboModuleRegistry: createTurboModuleRegistry(target),
    resolveNativeModule(name) {
      return resolveNativeModule(target, name);
    },
    resolveTurboModule(name) {
      return resolveTurboModule(target, name);
    },
  };
}

function mergeBridgeIntoReactNativeModule(target, bridge) {
  const registry = ensureRuntimeShimRegistry(target);
  const existingModule = registry[REACT_NATIVE_MODULE_ID];
  const reactNativeModule =
    existingModule && typeof existingModule === 'object' ? existingModule : {};

  reactNativeModule.NativeModules = bridge.NativeModules;
  reactNativeModule.TurboModuleRegistry = bridge.TurboModuleRegistry;
  reactNativeModule.default = reactNativeModule.default ?? reactNativeModule;
  reactNativeModule.__esModule = true;

  registry[REACT_NATIVE_MODULE_ID] = reactNativeModule;
  return reactNativeModule;
}

function installNativeModulesBridge(target = globalThis) {
  const normalizedTarget = ensureBridgeTarget(target);
  const existingBridge = normalizedTarget[NATIVE_MODULE_BRIDGE_GLOBAL_KEY];
  const bridge =
    existingBridge && typeof existingBridge === 'object'
      ? existingBridge
      : createNativeModuleBridge(normalizedTarget);

  normalizedTarget[NATIVE_MODULE_BRIDGE_GLOBAL_KEY] = bridge;
  normalizedTarget.NativeModules = bridge.NativeModules;
  normalizedTarget.TurboModuleRegistry = bridge.TurboModuleRegistry;

  mergeBridgeIntoReactNativeModule(normalizedTarget, bridge);

  return bridge;
}

const nativeModulesShim = {
  id: SHIM_ID,
  install: installNativeModulesBridge,
  applyRuntimeShim: installNativeModulesBridge,
  createNativeModuleBridge,
  ensureRuntimeShimRegistry,
  installNativeModulesBridge,
  mergeBridgeIntoReactNativeModule,
  resolveModuleFromSource,
  resolveNativeModule,
  resolveTurboModule,
  NATIVE_MODULE_BRIDGE_GLOBAL_KEY,
  REACT_NATIVE_MODULE_ID,
  RUNTIME_SHIM_REGISTRY_KEY,
  SHIM_ID,
};

nativeModulesShim.default = nativeModulesShim;
nativeModulesShim.__esModule = true;

module.exports = nativeModulesShim;

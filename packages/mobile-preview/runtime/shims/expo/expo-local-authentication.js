const MODULE_ID = 'expo-local-authentication';
const RUNTIME_SHIM_REGISTRY_KEY = '__onlookShims';
const NATIVE_MODULE_CANDIDATES = [
  'ExpoLocalAuthentication',
  'ExponentLocalAuthentication',
];

const AuthenticationType = Object.freeze({
  FINGERPRINT: 1,
  FACIAL_RECOGNITION: 2,
  IRIS: 3,
});

const SecurityLevel = Object.freeze({
  NONE: 0,
  SECRET: 1,
  BIOMETRIC_WEAK: 2,
  BIOMETRIC_STRONG: 3,
});

function ensureRuntimeShimRegistry(target) {
  if (!target || typeof target !== 'object') {
    throw new TypeError('expo-local-authentication shim requires an object target');
  }

  if (!target[RUNTIME_SHIM_REGISTRY_KEY] || typeof target[RUNTIME_SHIM_REGISTRY_KEY] !== 'object') {
    target[RUNTIME_SHIM_REGISTRY_KEY] = {};
  }

  return target[RUNTIME_SHIM_REGISTRY_KEY];
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

function resolveModuleFromBridge(target, name) {
  const bridge = target && target.__onlookNativeModuleBridge;

  if (!bridge || typeof bridge !== 'object') {
    return null;
  }

  try {
    if (typeof bridge.resolveTurboModule === 'function') {
      const module = bridge.resolveTurboModule(name);

      if (module != null) {
        return module;
      }
    }
  } catch (_) {}

  try {
    if (typeof bridge.resolveNativeModule === 'function') {
      const module = bridge.resolveNativeModule(name);

      if (module != null) {
        return module;
      }
    }
  } catch (_) {}

  return null;
}

function resolveModuleFromTurboRegistry(target, name) {
  const registry = target && target.TurboModuleRegistry;

  if (!registry || typeof registry !== 'object' || typeof registry.get !== 'function') {
    return null;
  }

  try {
    return registry.get(name) ?? null;
  } catch (_) {
    return null;
  }
}

function resolveLocalAuthenticationNativeModule(target) {
  for (const moduleName of NATIVE_MODULE_CANDIDATES) {
    const module =
      resolveModuleFromBridge(target, moduleName) ??
      resolveModuleFromTurboRegistry(target, moduleName) ??
      resolveModuleFromSource(target && target.NativeModules, moduleName) ??
      resolveModuleFromSource(target && target.__turboModuleProxy, moduleName) ??
      resolveModuleFromSource(target && target.nativeModuleProxy, moduleName);

    if (module != null) {
      return module;
    }
  }

  return null;
}

function callNativeAsyncMethod(target, methodName, args, fallbackValue) {
  const nativeModule = resolveLocalAuthenticationNativeModule(target);
  const method = nativeModule && nativeModule[methodName];

  if (typeof method !== 'function') {
    return Promise.resolve(
      typeof fallbackValue === 'function' ? fallbackValue() : fallbackValue,
    );
  }

  return Promise.resolve(method.apply(nativeModule, args));
}

function createFallbackAuthenticationResult() {
  return {
    success: false,
    error: 'not_available',
  };
}

function createExpoLocalAuthenticationModule(target = globalThis) {
  const moduleExports = {
    AuthenticationType,
    SecurityLevel,
    authenticateAsync(options) {
      return callNativeAsyncMethod(
        target,
        'authenticateAsync',
        [options],
        createFallbackAuthenticationResult,
      );
    },
    cancelAuthenticate() {
      return callNativeAsyncMethod(target, 'cancelAuthenticate', [], undefined).then(
        () => undefined,
      );
    },
    getEnrolledLevelAsync() {
      return callNativeAsyncMethod(
        target,
        'getEnrolledLevelAsync',
        [],
        SecurityLevel.NONE,
      );
    },
    hasHardwareAsync() {
      return callNativeAsyncMethod(target, 'hasHardwareAsync', [], false);
    },
    isEnrolledAsync() {
      return callNativeAsyncMethod(target, 'isEnrolledAsync', [], false);
    },
    supportedAuthenticationTypesAsync() {
      return callNativeAsyncMethod(
        target,
        'supportedAuthenticationTypesAsync',
        [],
        () => [],
      );
    },
  };

  moduleExports.default = moduleExports;
  moduleExports.__esModule = true;

  return moduleExports;
}

function mergeRuntimeModule(existingModule, nextModule) {
  for (const [key, value] of Object.entries(nextModule)) {
    if (key === 'default' || key === '__esModule') {
      continue;
    }

    if (!(key in existingModule)) {
      existingModule[key] = value;
    }
  }

  existingModule.default = existingModule.default ?? existingModule;
  existingModule.__esModule = true;
  return existingModule;
}

function installExpoLocalAuthenticationShim(target = globalThis) {
  const registry = ensureRuntimeShimRegistry(target);
  const existingModule = registry[MODULE_ID];
  const nextModule = createExpoLocalAuthenticationModule(target);

  if (existingModule && typeof existingModule === 'object') {
    return mergeRuntimeModule(existingModule, nextModule);
  }

  registry[MODULE_ID] = nextModule;
  return nextModule;
}

module.exports = installExpoLocalAuthenticationShim;
module.exports.install = installExpoLocalAuthenticationShim;
module.exports.applyRuntimeShim = installExpoLocalAuthenticationShim;
module.exports.createExpoLocalAuthenticationModule = createExpoLocalAuthenticationModule;
module.exports.resolveLocalAuthenticationNativeModule = resolveLocalAuthenticationNativeModule;
module.exports.ensureRuntimeShimRegistry = ensureRuntimeShimRegistry;
module.exports.mergeRuntimeModule = mergeRuntimeModule;
module.exports.AuthenticationType = AuthenticationType;
module.exports.SecurityLevel = SecurityLevel;
module.exports.MODULE_ID = MODULE_ID;
module.exports.RUNTIME_SHIM_REGISTRY_KEY = RUNTIME_SHIM_REGISTRY_KEY;
module.exports.NATIVE_MODULE_CANDIDATES = NATIVE_MODULE_CANDIDATES;

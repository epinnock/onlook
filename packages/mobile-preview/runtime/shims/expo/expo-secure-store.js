const MODULE_ID = 'expo-secure-store';
const RUNTIME_SHIM_REGISTRY_KEY = '__onlookShims';
const SECURE_STORE_STATE_KEY = '__onlookExpoSecureStoreState';

const KEYCHAIN_ACCESSIBILITY_CONSTANTS = {
  AFTER_FIRST_UNLOCK: 'AFTER_FIRST_UNLOCK',
  AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY: 'AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY',
  ALWAYS: 'ALWAYS',
  ALWAYS_THIS_DEVICE_ONLY: 'ALWAYS_THIS_DEVICE_ONLY',
  WHEN_PASSCODE_SET_THIS_DEVICE_ONLY: 'WHEN_PASSCODE_SET_THIS_DEVICE_ONLY',
  WHEN_UNLOCKED: 'WHEN_UNLOCKED',
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'WHEN_UNLOCKED_THIS_DEVICE_ONLY',
};

function ensureSecureStoreTarget(target) {
  if (!target || typeof target !== 'object') {
    throw new TypeError('expo-secure-store shim requires an object target');
  }

  return target;
}

function ensureRuntimeShimRegistry(target) {
  const normalizedTarget = ensureSecureStoreTarget(target);

  if (
    !normalizedTarget[RUNTIME_SHIM_REGISTRY_KEY] ||
    typeof normalizedTarget[RUNTIME_SHIM_REGISTRY_KEY] !== 'object'
  ) {
    normalizedTarget[RUNTIME_SHIM_REGISTRY_KEY] = {};
  }

  return normalizedTarget[RUNTIME_SHIM_REGISTRY_KEY];
}

function ensureSecureStoreState(target) {
  const normalizedTarget = ensureSecureStoreTarget(target);
  const existingState = normalizedTarget[SECURE_STORE_STATE_KEY];

  if (existingState instanceof Map) {
    return existingState;
  }

  const nextState = new Map();
  normalizedTarget[SECURE_STORE_STATE_KEY] = nextState;
  return nextState;
}

function normalizeStorageKey(key) {
  if (typeof key !== 'string') {
    throw new TypeError('expo-secure-store shim keys must be strings');
  }

  return key;
}

function normalizeStorageValue(value) {
  if (typeof value !== 'string') {
    throw new TypeError('expo-secure-store shim values must be strings');
  }

  return value;
}

function getStoredValue(target, key) {
  const storageKey = normalizeStorageKey(key);
  const state = ensureSecureStoreState(target);
  return state.has(storageKey) ? state.get(storageKey) : null;
}

function setStoredValue(target, key, value) {
  ensureSecureStoreState(target).set(
    normalizeStorageKey(key),
    normalizeStorageValue(value),
  );
}

function deleteStoredValue(target, key) {
  ensureSecureStoreState(target).delete(normalizeStorageKey(key));
}

function createExpoSecureStoreModule(target = globalThis) {
  const moduleExports = {
    ...KEYCHAIN_ACCESSIBILITY_CONSTANTS,
    canUseBiometricAuthentication() {
      return false;
    },
    deleteItem(key) {
      deleteStoredValue(target, key);
    },
    async deleteItemAsync(key) {
      deleteStoredValue(target, key);
    },
    getItem(key) {
      return getStoredValue(target, key);
    },
    async getItemAsync(key) {
      return getStoredValue(target, key);
    },
    async isAvailableAsync() {
      return true;
    },
    setItem(key, value) {
      setStoredValue(target, key, value);
    },
    async setItemAsync(key, value) {
      setStoredValue(target, key, value);
    },
  };

  moduleExports.default = moduleExports;
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

  existingModule.default = existingModule.default ?? existingModule;
  existingModule.__esModule = true;
  return existingModule;
}

function installExpoSecureStoreShim(target = globalThis) {
  const registry = ensureRuntimeShimRegistry(target);
  const existingModule = registry[MODULE_ID];
  const secureStoreModule = createExpoSecureStoreModule(target);

  if (existingModule && typeof existingModule === 'object') {
    return mergeRuntimeModule(existingModule, secureStoreModule);
  }

  registry[MODULE_ID] = secureStoreModule;
  return secureStoreModule;
}

module.exports = installExpoSecureStoreShim;
module.exports.install = installExpoSecureStoreShim;
module.exports.applyRuntimeShim = installExpoSecureStoreShim;
module.exports.createExpoSecureStoreModule = createExpoSecureStoreModule;
module.exports.ensureRuntimeShimRegistry = ensureRuntimeShimRegistry;
module.exports.ensureSecureStoreState = ensureSecureStoreState;
module.exports.mergeRuntimeModule = mergeRuntimeModule;
module.exports.KEYCHAIN_ACCESSIBILITY_CONSTANTS = KEYCHAIN_ACCESSIBILITY_CONSTANTS;
module.exports.MODULE_ID = MODULE_ID;
module.exports.RUNTIME_SHIM_REGISTRY_KEY = RUNTIME_SHIM_REGISTRY_KEY;
module.exports.SECURE_STORE_STATE_KEY = SECURE_STORE_STATE_KEY;

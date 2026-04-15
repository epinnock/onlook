const SHIM_ID = 'device-metadata';
const RUNTIME_SHIM_REGISTRY_KEY = '__onlookShims';

const MODULE_IDS = {
  constants: 'expo-constants',
  device: 'expo-device',
  network: 'expo-network',
  battery: 'expo-battery',
};

const NATIVE_MODULE_IDS = {
  constants: 'ExponentConstants',
  device: 'ExpoDevice',
  network: 'ExpoNetwork',
  battery: 'ExpoBattery',
};

const APP_OWNERSHIP = {
  Expo: 'expo',
};

const EXECUTION_ENVIRONMENT = {
  Bare: 'bare',
  Standalone: 'standalone',
  StoreClient: 'storeClient',
};

const USER_INTERFACE_IDIOM = {
  Handset: 'handset',
  Tablet: 'tablet',
  Desktop: 'desktop',
  TV: 'tv',
  Unsupported: 'unsupported',
};

const DEVICE_TYPE = {
  UNKNOWN: 0,
  PHONE: 1,
  TABLET: 2,
  DESKTOP: 3,
  TV: 4,
};

const NETWORK_STATE_TYPE = {
  NONE: 'NONE',
  UNKNOWN: 'UNKNOWN',
  CELLULAR: 'CELLULAR',
  WIFI: 'WIFI',
  BLUETOOTH: 'BLUETOOTH',
  ETHERNET: 'ETHERNET',
  WIMAX: 'WIMAX',
  VPN: 'VPN',
  OTHER: 'OTHER',
};

const BATTERY_STATE = {
  UNKNOWN: 0,
  UNPLUGGED: 1,
  CHARGING: 2,
  FULL: 3,
};

const DEFAULT_EXPO_CONFIG = Object.freeze({
  name: 'Onlook Preview',
  slug: 'onlook-preview',
  scheme: 'onlook-preview',
  version: '1.0.0',
  platforms: ['ios', 'android'],
});

const DEFAULT_DEVICE_STATE = Object.freeze({
  brand: 'Apple',
  deviceName: 'Onlook Preview Device',
  deviceType: DEVICE_TYPE.PHONE,
  isDevice: true,
  manufacturer: 'Apple',
  modelName: 'iPhone',
  osName: 'iOS',
  osVersion: null,
});

const DEFAULT_NETWORK_STATE = Object.freeze({
  isConnected: true,
  isInternetReachable: true,
  type: NETWORK_STATE_TYPE.WIFI,
});

const DEFAULT_BATTERY_POWER_STATE = Object.freeze({
  batteryLevel: 1,
  batteryState: BATTERY_STATE.FULL,
  lowPowerMode: false,
});

function ensureRuntimeShimRegistry(target) {
  if (!target || (typeof target !== 'object' && typeof target !== 'function')) {
    throw new TypeError('device metadata shim requires an object target');
  }

  if (!target[RUNTIME_SHIM_REGISTRY_KEY] || typeof target[RUNTIME_SHIM_REGISTRY_KEY] !== 'object') {
    target[RUNTIME_SHIM_REGISTRY_KEY] = {};
  }

  return target[RUNTIME_SHIM_REGISTRY_KEY];
}

function resolveModuleFromSource(source, moduleId) {
  if (!source) {
    return null;
  }

  try {
    if (typeof source === 'function') {
      return source(moduleId) ?? null;
    }

    if (typeof source === 'object') {
      return source[moduleId] ?? null;
    }
  } catch (_) {
    return null;
  }

  return null;
}

function resolveNativeModule(target, moduleId) {
  const bridge = target && target.__onlookNativeModuleBridge;

  if (bridge && typeof bridge.resolveNativeModule === 'function') {
    const nativeModule = bridge.resolveNativeModule(moduleId);
    if (nativeModule != null) {
      return nativeModule;
    }
  }

  if (bridge && typeof bridge.resolveTurboModule === 'function') {
    const turboModule = bridge.resolveTurboModule(moduleId);
    if (turboModule != null) {
      return turboModule;
    }
  }

  return (
    resolveModuleFromSource(target && target.NativeModules, moduleId) ??
    resolveModuleFromSource(target && target.nativeModuleProxy, moduleId) ??
    resolveModuleFromSource(target && target.__turboModuleProxy, moduleId)
  );
}

function cloneArray(value, fallback) {
  if (Array.isArray(value)) {
    return [...value];
  }

  return Array.isArray(fallback) ? [...fallback] : fallback;
}

function cloneObject(value, fallback) {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return { ...value };
  }

  if (fallback && typeof fallback === 'object' && !Array.isArray(fallback)) {
    return { ...fallback };
  }

  return fallback;
}

function parseManifestValue(value) {
  if (typeof value === 'string') {
    try {
      return JSON.parse(value);
    } catch (_) {
      return null;
    }
  }

  if (value && typeof value === 'object') {
    return { ...value };
  }

  return null;
}

function createNoopSubscription() {
  return {
    remove() {},
  };
}

function callNativeMethod(nativeModule, methodName, args, fallbackValue) {
  if (nativeModule && typeof nativeModule[methodName] === 'function') {
    return nativeModule[methodName](...args);
  }

  return Promise.resolve(fallbackValue);
}

function getExpoConfig(nativeModule) {
  const configFromConstants = cloneObject(nativeModule && nativeModule.expoConfig, null);
  if (configFromConstants) {
    return configFromConstants;
  }

  const manifest = parseManifestValue(nativeModule && nativeModule.manifest);
  if (manifest) {
    return manifest;
  }

  return cloneObject(DEFAULT_EXPO_CONFIG, DEFAULT_EXPO_CONFIG);
}

function createExpoConstantsValue(target) {
  const nativeModule = resolveNativeModule(target, NATIVE_MODULE_IDS.constants);
  const expoConfig = getExpoConfig(nativeModule);
  const executionEnvironment =
    nativeModule && nativeModule.executionEnvironment != null
      ? nativeModule.executionEnvironment
      : EXECUTION_ENVIRONMENT.StoreClient;
  const manifest = parseManifestValue(nativeModule && nativeModule.manifest) ?? cloneObject(expoConfig, expoConfig);

  return {
    appOwnership:
      nativeModule && 'appOwnership' in nativeModule
        ? nativeModule.appOwnership
        : executionEnvironment === EXECUTION_ENVIRONMENT.StoreClient
          ? APP_OWNERSHIP.Expo
          : null,
    debugMode: Boolean(nativeModule && nativeModule.debugMode),
    deviceName:
      nativeModule && nativeModule.deviceName != null
        ? nativeModule.deviceName
        : DEFAULT_DEVICE_STATE.deviceName,
    deviceYearClass:
      nativeModule && nativeModule.deviceYearClass != null
        ? nativeModule.deviceYearClass
        : null,
    easConfig: cloneObject(nativeModule && nativeModule.easConfig, null),
    executionEnvironment,
    experienceUrl:
      nativeModule && typeof nativeModule.experienceUrl === 'string'
        ? nativeModule.experienceUrl
        : '',
    expoConfig,
    expoGoConfig: cloneObject(nativeModule && nativeModule.expoGoConfig, null),
    expoRuntimeVersion:
      nativeModule && 'expoRuntimeVersion' in nativeModule
        ? nativeModule.expoRuntimeVersion
        : null,
    expoVersion:
      nativeModule && 'expoVersion' in nativeModule ? nativeModule.expoVersion : null,
    getWebViewUserAgentAsync:
      nativeModule && typeof nativeModule.getWebViewUserAgentAsync === 'function'
        ? nativeModule.getWebViewUserAgentAsync.bind(nativeModule)
        : async () => null,
    isDetached: Boolean(nativeModule && nativeModule.isDetached),
    isHeadless: Boolean(nativeModule && nativeModule.isHeadless),
    linkingUri:
      nativeModule && typeof nativeModule.linkingUri === 'string'
        ? nativeModule.linkingUri
        : 'onlook://mobile-preview',
    manifest,
    manifest2: cloneObject(nativeModule && nativeModule.manifest2, null),
    platform: cloneObject(nativeModule && nativeModule.platform, null),
    sessionId:
      nativeModule && typeof nativeModule.sessionId === 'string'
        ? nativeModule.sessionId
        : 'onlook-mobile-preview',
    statusBarHeight:
      nativeModule && typeof nativeModule.statusBarHeight === 'number'
        ? nativeModule.statusBarHeight
        : 0,
    supportedExpoSdks: cloneArray(nativeModule && nativeModule.supportedExpoSdks, undefined),
    systemFonts: cloneArray(nativeModule && nativeModule.systemFonts, []),
  };
}

function createExpoConstantsModule(target = globalThis) {
  const constants = createExpoConstantsValue(target);
  const moduleExports = {
    ...constants,
    AppOwnership: APP_OWNERSHIP,
    ExecutionEnvironment: EXECUTION_ENVIRONMENT,
    UserInterfaceIdiom: USER_INTERFACE_IDIOM,
  };

  moduleExports.default = constants;
  moduleExports.__esModule = true;

  return moduleExports;
}

function createExpoDeviceState(target) {
  const nativeModule = resolveNativeModule(target, NATIVE_MODULE_IDS.device);

  return {
    brand:
      nativeModule && 'brand' in nativeModule ? nativeModule.brand : DEFAULT_DEVICE_STATE.brand,
    designName:
      nativeModule && 'designName' in nativeModule ? nativeModule.designName : null,
    deviceName:
      nativeModule && 'deviceName' in nativeModule
        ? nativeModule.deviceName
        : DEFAULT_DEVICE_STATE.deviceName,
    deviceType:
      nativeModule && nativeModule.deviceType != null
        ? nativeModule.deviceType
        : DEFAULT_DEVICE_STATE.deviceType,
    deviceYearClass:
      nativeModule && 'deviceYearClass' in nativeModule
        ? nativeModule.deviceYearClass
        : null,
    isDevice:
      nativeModule && 'isDevice' in nativeModule
        ? nativeModule.isDevice
        : DEFAULT_DEVICE_STATE.isDevice,
    manufacturer:
      nativeModule && 'manufacturer' in nativeModule
        ? nativeModule.manufacturer
        : DEFAULT_DEVICE_STATE.manufacturer,
    modelId: nativeModule && 'modelId' in nativeModule ? nativeModule.modelId : null,
    modelName:
      nativeModule && 'modelName' in nativeModule
        ? nativeModule.modelName
        : DEFAULT_DEVICE_STATE.modelName,
    osBuildFingerprint:
      nativeModule && 'osBuildFingerprint' in nativeModule
        ? nativeModule.osBuildFingerprint
        : null,
    osBuildId:
      nativeModule && 'osBuildId' in nativeModule ? nativeModule.osBuildId : null,
    osInternalBuildId:
      nativeModule && 'osInternalBuildId' in nativeModule
        ? nativeModule.osInternalBuildId
        : nativeModule && 'osBuildId' in nativeModule
          ? nativeModule.osBuildId
          : null,
    osName:
      nativeModule && 'osName' in nativeModule ? nativeModule.osName : DEFAULT_DEVICE_STATE.osName,
    osVersion:
      nativeModule && 'osVersion' in nativeModule
        ? nativeModule.osVersion
        : DEFAULT_DEVICE_STATE.osVersion,
    platformApiLevel:
      nativeModule && 'platformApiLevel' in nativeModule
        ? nativeModule.platformApiLevel
        : null,
    productName:
      nativeModule && 'productName' in nativeModule ? nativeModule.productName : null,
    supportedCpuArchitectures: cloneArray(
      nativeModule && nativeModule.supportedCpuArchitectures,
      null,
    ),
    totalMemory:
      nativeModule && typeof nativeModule.totalMemory === 'number'
        ? nativeModule.totalMemory
        : null,
  };
}

function createExpoDeviceModule(target = globalThis) {
  const nativeModule = resolveNativeModule(target, NATIVE_MODULE_IDS.device);
  const deviceState = createExpoDeviceState(target);
  const platformFeatures = cloneArray(nativeModule && nativeModule.platformFeatures, []);

  const moduleExports = {
    ...deviceState,
    DeviceType: DEVICE_TYPE,
    getDeviceTypeAsync() {
      return callNativeMethod(
        nativeModule,
        'getDeviceTypeAsync',
        [],
        deviceState.deviceType ?? DEVICE_TYPE.UNKNOWN,
      );
    },
    getMaxMemoryAsync() {
      return callNativeMethod(
        nativeModule,
        'getMaxMemoryAsync',
        [],
        deviceState.totalMemory ?? Number.MAX_SAFE_INTEGER,
      );
    },
    getPlatformFeaturesAsync() {
      return callNativeMethod(nativeModule, 'getPlatformFeaturesAsync', [], [...platformFeatures]);
    },
    getUptimeAsync() {
      return callNativeMethod(nativeModule, 'getUptimeAsync', [], 0);
    },
    hasPlatformFeatureAsync(feature) {
      const fallbackValue = platformFeatures.includes(feature);
      return callNativeMethod(nativeModule, 'hasPlatformFeatureAsync', [feature], fallbackValue);
    },
    isRootedExperimentalAsync() {
      return callNativeMethod(nativeModule, 'isRootedExperimentalAsync', [], false);
    },
    isSideLoadingEnabledAsync() {
      return callNativeMethod(nativeModule, 'isSideLoadingEnabledAsync', [], false);
    },
  };

  moduleExports.default = moduleExports;
  moduleExports.__esModule = true;

  return moduleExports;
}

function getNetworkState(target) {
  const nativeModule = resolveNativeModule(target, NATIVE_MODULE_IDS.network);

  return {
    isConnected:
      nativeModule && 'isConnected' in nativeModule
        ? nativeModule.isConnected
        : DEFAULT_NETWORK_STATE.isConnected,
    isInternetReachable:
      nativeModule && 'isInternetReachable' in nativeModule
        ? nativeModule.isInternetReachable
        : DEFAULT_NETWORK_STATE.isInternetReachable,
    type:
      nativeModule && 'type' in nativeModule ? nativeModule.type : DEFAULT_NETWORK_STATE.type,
  };
}

function createExpoNetworkModule(target = globalThis) {
  const nativeModule = resolveNativeModule(target, NATIVE_MODULE_IDS.network);
  const networkState = getNetworkState(target);

  const moduleExports = {
    NetworkStateType: NETWORK_STATE_TYPE,
    addNetworkStateListener(listener) {
      if (nativeModule && typeof nativeModule.addNetworkStateListener === 'function') {
        return nativeModule.addNetworkStateListener(listener);
      }

      return createNoopSubscription();
    },
    getIpAddressAsync() {
      const fallbackValue =
        nativeModule && typeof nativeModule.ipAddress === 'string'
          ? nativeModule.ipAddress
          : '0.0.0.0';

      return callNativeMethod(nativeModule, 'getIpAddressAsync', [], fallbackValue);
    },
    getNetworkStateAsync() {
      return callNativeMethod(nativeModule, 'getNetworkStateAsync', [], { ...networkState });
    },
    isAirplaneModeEnabledAsync() {
      const fallbackValue =
        nativeModule && typeof nativeModule.isAirplaneModeEnabled === 'boolean'
          ? nativeModule.isAirplaneModeEnabled
          : false;

      return callNativeMethod(
        nativeModule,
        'isAirplaneModeEnabledAsync',
        [],
        fallbackValue,
      );
    },
    useNetworkState() {
      return { ...networkState };
    },
  };

  moduleExports.default = moduleExports;
  moduleExports.__esModule = true;

  return moduleExports;
}

function getBatteryPowerState(target) {
  const nativeModule = resolveNativeModule(target, NATIVE_MODULE_IDS.battery);

  return {
    batteryLevel:
      nativeModule && typeof nativeModule.batteryLevel === 'number'
        ? nativeModule.batteryLevel
        : DEFAULT_BATTERY_POWER_STATE.batteryLevel,
    batteryState:
      nativeModule && nativeModule.batteryState != null
        ? nativeModule.batteryState
        : DEFAULT_BATTERY_POWER_STATE.batteryState,
    lowPowerMode:
      nativeModule && typeof nativeModule.lowPowerMode === 'boolean'
        ? nativeModule.lowPowerMode
        : DEFAULT_BATTERY_POWER_STATE.lowPowerMode,
  };
}

function createExpoBatteryModule(target = globalThis) {
  const nativeModule = resolveNativeModule(target, NATIVE_MODULE_IDS.battery);
  const powerState = getBatteryPowerState(target);

  const moduleExports = {
    BatteryState: BATTERY_STATE,
    addBatteryLevelListener(listener) {
      if (nativeModule && typeof nativeModule.addBatteryLevelListener === 'function') {
        return nativeModule.addBatteryLevelListener(listener);
      }

      return createNoopSubscription();
    },
    addBatteryStateListener(listener) {
      if (nativeModule && typeof nativeModule.addBatteryStateListener === 'function') {
        return nativeModule.addBatteryStateListener(listener);
      }

      return createNoopSubscription();
    },
    addLowPowerModeListener(listener) {
      if (nativeModule && typeof nativeModule.addLowPowerModeListener === 'function') {
        return nativeModule.addLowPowerModeListener(listener);
      }

      return createNoopSubscription();
    },
    getBatteryLevelAsync() {
      return callNativeMethod(
        nativeModule,
        'getBatteryLevelAsync',
        [],
        powerState.batteryLevel,
      );
    },
    getBatteryStateAsync() {
      return callNativeMethod(
        nativeModule,
        'getBatteryStateAsync',
        [],
        powerState.batteryState,
      );
    },
    getPowerStateAsync() {
      return callNativeMethod(nativeModule, 'getPowerStateAsync', [], { ...powerState });
    },
    isAvailableAsync() {
      const fallbackValue =
        nativeModule && typeof nativeModule.isAvailable === 'boolean'
          ? nativeModule.isAvailable
          : true;

      return callNativeMethod(nativeModule, 'isAvailableAsync', [], fallbackValue);
    },
    isBatteryOptimizationEnabledAsync() {
      const fallbackValue =
        nativeModule && typeof nativeModule.isBatteryOptimizationEnabled === 'boolean'
          ? nativeModule.isBatteryOptimizationEnabled
          : false;

      return callNativeMethod(
        nativeModule,
        'isBatteryOptimizationEnabledAsync',
        [],
        fallbackValue,
      );
    },
    isLowPowerModeEnabledAsync() {
      return callNativeMethod(
        nativeModule,
        'isLowPowerModeEnabledAsync',
        [],
        powerState.lowPowerMode,
      );
    },
    useBatteryLevel() {
      return powerState.batteryLevel;
    },
    useBatteryState() {
      return powerState.batteryState;
    },
    useLowPowerMode() {
      return powerState.lowPowerMode;
    },
    usePowerState() {
      return { ...powerState };
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

  if (!('default' in existingModule) || existingModule.default == null) {
    existingModule.default =
      nextModule.default === nextModule ? existingModule : nextModule.default ?? existingModule;
  }

  existingModule.__esModule = true;
  return existingModule;
}

function installDeviceMetadataShim(target = globalThis) {
  const registry = ensureRuntimeShimRegistry(target);
  const installedModules = {};
  const moduleFactories = [
    [MODULE_IDS.constants, createExpoConstantsModule],
    [MODULE_IDS.device, createExpoDeviceModule],
    [MODULE_IDS.network, createExpoNetworkModule],
    [MODULE_IDS.battery, createExpoBatteryModule],
  ];

  for (const [moduleId, createModule] of moduleFactories) {
    const nextModule = createModule(target);
    const existingModule = registry[moduleId];

    if (existingModule && typeof existingModule === 'object') {
      installedModules[moduleId] = mergeRuntimeModule(existingModule, nextModule);
      continue;
    }

    registry[moduleId] = nextModule;
    installedModules[moduleId] = nextModule;
  }

  return installedModules;
}

module.exports = installDeviceMetadataShim;
module.exports.install = installDeviceMetadataShim;
module.exports.applyRuntimeShim = installDeviceMetadataShim;
module.exports.createExpoBatteryModule = createExpoBatteryModule;
module.exports.createExpoConstantsModule = createExpoConstantsModule;
module.exports.createExpoDeviceModule = createExpoDeviceModule;
module.exports.createExpoNetworkModule = createExpoNetworkModule;
module.exports.ensureRuntimeShimRegistry = ensureRuntimeShimRegistry;
module.exports.mergeRuntimeModule = mergeRuntimeModule;
module.exports.APP_OWNERSHIP = APP_OWNERSHIP;
module.exports.BATTERY_STATE = BATTERY_STATE;
module.exports.DEVICE_TYPE = DEVICE_TYPE;
module.exports.EXECUTION_ENVIRONMENT = EXECUTION_ENVIRONMENT;
module.exports.MODULE_IDS = MODULE_IDS;
module.exports.NETWORK_STATE_TYPE = NETWORK_STATE_TYPE;
module.exports.RUNTIME_SHIM_REGISTRY_KEY = RUNTIME_SHIM_REGISTRY_KEY;
module.exports.SHIM_ID = SHIM_ID;
module.exports.USER_INTERFACE_IDIOM = USER_INTERFACE_IDIOM;

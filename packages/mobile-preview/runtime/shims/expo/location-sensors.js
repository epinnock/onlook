const LOCATION_MODULE_ID = 'expo-location';
const SENSORS_MODULE_ID = 'expo-sensors';
const RUNTIME_SHIM_REGISTRY_KEY = '__onlookShims';

function ensureRuntimeShimRegistry(target) {
  if (!target || typeof target !== 'object') {
    throw new TypeError('expo location/sensors shim requires an object target');
  }

  if (!target[RUNTIME_SHIM_REGISTRY_KEY] || typeof target[RUNTIME_SHIM_REGISTRY_KEY] !== 'object') {
    target[RUNTIME_SHIM_REGISTRY_KEY] = {};
  }

  return target[RUNTIME_SHIM_REGISTRY_KEY];
}

function scheduleSubscriptionCallback(callback, valueFactory) {
  let active = true;

  if (typeof callback === 'function') {
    const dispatch = () => {
      if (!active) {
        return;
      }

      callback(valueFactory());
    };

    if (typeof queueMicrotask === 'function') {
      queueMicrotask(dispatch);
    } else {
      Promise.resolve().then(dispatch);
    }
  }

  return {
    remove() {
      active = false;
    },
  };
}

function createPermissionResponse() {
  return {
    canAskAgain: true,
    expires: 'never',
    granted: true,
    status: 'granted',
  };
}

function createLocationObject() {
  return {
    coords: {
      accuracy: 0,
      altitude: null,
      altitudeAccuracy: null,
      heading: 0,
      latitude: 0,
      longitude: 0,
      speed: 0,
    },
    mocked: false,
    timestamp: Date.now(),
  };
}

function createHeadingObject() {
  return {
    accuracy: 0,
    magHeading: 0,
    trueHeading: 0,
  };
}

function createAxesReading() {
  return {
    x: 0,
    y: 0,
    z: 0,
  };
}

function createDeviceMotionReading() {
  return {
    acceleration: createAxesReading(),
    accelerationIncludingGravity: createAxesReading(),
    interval: 0,
    orientation: 0,
    rotation: createAxesReading(),
    rotationRate: createAxesReading(),
  };
}

function createBarometerReading() {
  return {
    pressure: 0,
    relativeAltitude: 0,
  };
}

function createStepCountReading() {
  return {
    steps: 0,
  };
}

function createSensorModule(readingFactory, extraExports = {}) {
  let updateInterval = 0;

  return {
    addListener(listener) {
      return scheduleSubscriptionCallback(listener, readingFactory);
    },
    isAvailableAsync() {
      return Promise.resolve(true);
    },
    removeAllListeners() {},
    setUpdateInterval(nextInterval) {
      updateInterval = Number.isFinite(nextInterval) ? nextInterval : updateInterval;
      return updateInterval;
    },
    ...extraExports,
  };
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

function installRuntimeModule(registry, moduleId, nextModule) {
  const existingModule = registry[moduleId];

  if (existingModule && typeof existingModule === 'object') {
    return mergeRuntimeModule(existingModule, nextModule);
  }

  registry[moduleId] = nextModule;
  return nextModule;
}

function createExpoLocationModule() {
  const Accuracy = {
    Lowest: 1,
    Low: 2,
    Balanced: 3,
    High: 4,
    Highest: 5,
    BestForNavigation: 6,
  };
  const PermissionStatus = {
    GRANTED: 'granted',
    DENIED: 'denied',
    UNDETERMINED: 'undetermined',
  };
  const ActivityType = {
    Other: 1,
    AutomotiveNavigation: 2,
    Fitness: 3,
    OtherNavigation: 4,
  };
  const GeofencingEventType = {
    Enter: 1,
    Exit: 2,
  };
  const GeofencingRegionState = {
    Unknown: 0,
    Inside: 1,
    Outside: 2,
  };

  const moduleExports = {
    Accuracy,
    ActivityType,
    GeofencingEventType,
    GeofencingRegionState,
    LocationAccuracy: Accuracy,
    PermissionStatus,
    enableNetworkProviderAsync() {
      return Promise.resolve(undefined);
    },
    geocodeAsync() {
      return Promise.resolve([]);
    },
    getBackgroundPermissionsAsync() {
      return Promise.resolve(createPermissionResponse());
    },
    getCurrentPositionAsync() {
      return Promise.resolve(createLocationObject());
    },
    getForegroundPermissionsAsync() {
      return Promise.resolve(createPermissionResponse());
    },
    getHeadingAsync() {
      return Promise.resolve(createHeadingObject());
    },
    getLastKnownPositionAsync() {
      return Promise.resolve(createLocationObject());
    },
    getProviderStatusAsync() {
      return Promise.resolve({
        backgroundModeEnabled: true,
        gpsAvailable: true,
        locationServicesEnabled: true,
        networkAvailable: true,
        passiveAvailable: true,
      });
    },
    hasServicesEnabledAsync() {
      return Promise.resolve(true);
    },
    hasStartedGeofencingAsync() {
      return Promise.resolve(false);
    },
    hasStartedLocationUpdatesAsync() {
      return Promise.resolve(false);
    },
    installWebGeolocationPolyfill() {},
    isBackgroundLocationAvailableAsync() {
      return Promise.resolve(true);
    },
    requestBackgroundPermissionsAsync() {
      return Promise.resolve(createPermissionResponse());
    },
    requestForegroundPermissionsAsync() {
      return Promise.resolve(createPermissionResponse());
    },
    reverseGeocodeAsync() {
      return Promise.resolve([]);
    },
    startGeofencingAsync() {
      return Promise.resolve(undefined);
    },
    startLocationUpdatesAsync() {
      return Promise.resolve(undefined);
    },
    stopGeofencingAsync() {
      return Promise.resolve(undefined);
    },
    stopLocationUpdatesAsync() {
      return Promise.resolve(undefined);
    },
    watchHeadingAsync(callback) {
      return Promise.resolve(
        scheduleSubscriptionCallback(callback, createHeadingObject),
      );
    },
    watchPositionAsync(_options, callback) {
      return Promise.resolve(
        scheduleSubscriptionCallback(callback, createLocationObject),
      );
    },
  };

  moduleExports.default = moduleExports;
  moduleExports.__esModule = true;

  return moduleExports;
}

function createExpoSensorsModule() {
  const Accelerometer = createSensorModule(createAxesReading);
  const Barometer = createSensorModule(createBarometerReading);
  const DeviceMotion = createSensorModule(createDeviceMotionReading);
  const Gyroscope = createSensorModule(createAxesReading);
  const LightSensor = createSensorModule(() => ({ illuminance: 0 }));
  const Magnetometer = createSensorModule(createAxesReading);
  const MagnetometerUncalibrated = createSensorModule(createAxesReading);
  const Pedometer = createSensorModule(createStepCountReading, {
    getStepCountAsync() {
      return Promise.resolve(createStepCountReading());
    },
    watchStepCount(callback) {
      return scheduleSubscriptionCallback(callback, createStepCountReading);
    },
  });

  const moduleExports = {
    Accelerometer,
    Barometer,
    DeviceMotion,
    Gyroscope,
    LightSensor,
    Magnetometer,
    MagnetometerUncalibrated,
    Pedometer,
    SensorTypes: {
      ACCELEROMETER: 'accelerometer',
      BAROMETER: 'barometer',
      DEVICEMOTION: 'deviceMotion',
      GYROSCOPE: 'gyroscope',
      LIGHT: 'light',
      MAGNETOMETER: 'magnetometer',
      MAGNETOMETER_UNCALIBRATED: 'magnetometerUncalibrated',
      PEDOMETER: 'pedometer',
    },
  };

  moduleExports.default = moduleExports;
  moduleExports.__esModule = true;

  return moduleExports;
}

function installExpoLocationSensorsShim(target = globalThis) {
  const registry = ensureRuntimeShimRegistry(target);
  const locationModule = installRuntimeModule(
    registry,
    LOCATION_MODULE_ID,
    createExpoLocationModule(),
  );
  const sensorsModule = installRuntimeModule(
    registry,
    SENSORS_MODULE_ID,
    createExpoSensorsModule(),
  );

  return {
    location: locationModule,
    sensors: sensorsModule,
  };
}

module.exports = installExpoLocationSensorsShim;
module.exports.install = installExpoLocationSensorsShim;
module.exports.applyRuntimeShim = installExpoLocationSensorsShim;
module.exports.createExpoLocationModule = createExpoLocationModule;
module.exports.createExpoSensorsModule = createExpoSensorsModule;
module.exports.ensureRuntimeShimRegistry = ensureRuntimeShimRegistry;
module.exports.mergeRuntimeModule = mergeRuntimeModule;
module.exports.LOCATION_MODULE_ID = LOCATION_MODULE_ID;
module.exports.SENSORS_MODULE_ID = SENSORS_MODULE_ID;
module.exports.RUNTIME_SHIM_REGISTRY_KEY = RUNTIME_SHIM_REGISTRY_KEY;

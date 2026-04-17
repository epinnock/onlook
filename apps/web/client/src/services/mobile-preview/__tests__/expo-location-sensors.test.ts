import { describe, expect, test } from 'bun:test';

type Subscription = { remove(): void };
type LocationReading = {
    coords: {
        accuracy: number;
        altitude: number | null;
        altitudeAccuracy: number | null;
        heading: number;
        latitude: number;
        longitude: number;
        speed: number;
    };
    mocked: boolean;
    timestamp: number;
};
type HeadingReading = { accuracy: number; magHeading: number; trueHeading: number };
type AxesReading = { x: number; y: number; z: number };
type StepReading = { steps: number };

type LocationModule = {
    default: unknown;
    __esModule: boolean;
    requestForegroundPermissionsAsync: () => Promise<unknown>;
    getCurrentPositionAsync: () => Promise<unknown>;
    reverseGeocodeAsync: () => Promise<unknown>;
    watchPositionAsync: (
        options: unknown,
        callback: (reading: LocationReading) => void,
    ) => Promise<Subscription>;
    watchHeadingAsync: (
        callback: (reading: HeadingReading) => void,
    ) => Promise<Subscription>;
};

type SensorsModule = {
    default: unknown;
    __esModule: boolean;
    Accelerometer: {
        isAvailableAsync: () => Promise<boolean>;
        addListener: (callback: (reading: AxesReading) => void) => Subscription;
    };
    Gyroscope: unknown;
    Pedometer: {
        getStepCountAsync: () => Promise<StepReading>;
        watchStepCount: (callback: (reading: StepReading) => void) => Subscription;
    };
    SensorTypes: Record<string, string>;
};

type ShimInstallResult = { location: LocationModule; sensors: SensorsModule };

type ShimInstaller = ((target: object) => ShimInstallResult) & {
    LOCATION_MODULE_ID: string;
    SENSORS_MODULE_ID: string;
    RUNTIME_SHIM_REGISTRY_KEY: string;
};

type ShimTarget = {
    [registryKey: string]: Record<string, LocationModule | SensorsModule>;
};

const installExpoLocationSensorsShim = require('../../../../../../../packages/mobile-preview/runtime/shims/expo/location-sensors.js') as ShimInstaller;

const {
    LOCATION_MODULE_ID,
    SENSORS_MODULE_ID,
    RUNTIME_SHIM_REGISTRY_KEY,
} = installExpoLocationSensorsShim;

function waitForScheduledCallbacks() {
    return new Promise((resolve) => {
        setTimeout(resolve, 0);
    });
}

describe('expo location/sensors shim', () => {
    test('installs expo-location and expo-sensors into __onlookShims', async () => {
        const target: ShimTarget = {};

        const installed = installExpoLocationSensorsShim(target);
        const registry = target[RUNTIME_SHIM_REGISTRY_KEY]!;
        const locationModule = registry[LOCATION_MODULE_ID] as LocationModule;
        const sensorsModule = registry[SENSORS_MODULE_ID] as SensorsModule;

        expect(installed.location).toBe(locationModule);
        expect(installed.sensors).toBe(sensorsModule);
        expect(locationModule.default).toBe(locationModule);
        expect(sensorsModule.default).toBe(sensorsModule);
        expect(locationModule.__esModule).toBe(true);
        expect(sensorsModule.__esModule).toBe(true);

        await expect(
            locationModule.requestForegroundPermissionsAsync(),
        ).resolves.toEqual({
            canAskAgain: true,
            expires: 'never',
            granted: true,
            status: 'granted',
        });
        await expect(locationModule.getCurrentPositionAsync()).resolves.toEqual({
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
            timestamp: expect.any(Number),
        });
        await expect(locationModule.reverseGeocodeAsync()).resolves.toEqual([]);
        await expect(sensorsModule.Accelerometer.isAvailableAsync()).resolves.toBe(
            true,
        );
        expect(sensorsModule.SensorTypes.PEDOMETER).toBe('pedometer');
        await expect(sensorsModule.Pedometer.getStepCountAsync()).resolves.toEqual(
            { steps: 0 },
        );
    });

    test('dispatches preview-safe location and sensor readings once per subscription', async () => {
        const { location, sensors } = installExpoLocationSensorsShim({});
        const locationEvents: LocationReading[] = [];
        const headingEvents: HeadingReading[] = [];
        const accelerometerEvents: AxesReading[] = [];
        const stepEvents: StepReading[] = [];

        const positionSubscription = await location.watchPositionAsync(
            {},
            (reading: LocationReading) => {
                locationEvents.push(reading);
            },
        );
        const headingSubscription = await location.watchHeadingAsync(
            (reading: HeadingReading) => {
                headingEvents.push(reading);
            },
        );
        const accelerometerSubscription = sensors.Accelerometer.addListener(
            (reading: AxesReading) => {
                accelerometerEvents.push(reading);
            },
        );
        const pedometerSubscription = sensors.Pedometer.watchStepCount(
            (reading: StepReading) => {
                stepEvents.push(reading);
            },
        );

        await waitForScheduledCallbacks();

        expect(locationEvents).toEqual([
            {
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
                timestamp: expect.any(Number),
            },
        ]);
        expect(headingEvents).toEqual([
            {
                accuracy: 0,
                magHeading: 0,
                trueHeading: 0,
            },
        ]);
        expect(accelerometerEvents).toEqual([
            {
                x: 0,
                y: 0,
                z: 0,
            },
        ]);
        expect(stepEvents).toEqual([{ steps: 0 }]);

        positionSubscription.remove();
        headingSubscription.remove();
        accelerometerSubscription.remove();
        pedometerSubscription.remove();
    });

    test('merges into existing expo-location and expo-sensors registry entries', () => {
        const customGetCurrentPositionAsync = async () => ({
            coords: {
                latitude: 41.881832,
                longitude: -87.623177,
            },
        });
        const existingLocationModule: Record<string, unknown> = {
            default: 'keep-location-default',
            getCurrentPositionAsync: customGetCurrentPositionAsync,
        };
        const existingAccelerometer = {
            addListener: () => ({ remove() {} }),
        };
        const existingSensorsModule: Record<string, unknown> = {
            Accelerometer: existingAccelerometer,
            default: 'keep-sensors-default',
        };
        const target = {
            __onlookShims: {
                'expo-location': existingLocationModule,
                'expo-sensors': existingSensorsModule,
            },
        };

        const installed = installExpoLocationSensorsShim(target);

        expect(installed.location as unknown).toBe(existingLocationModule);
        expect(installed.sensors as unknown).toBe(existingSensorsModule);
        expect(existingLocationModule.getCurrentPositionAsync).toBe(
            customGetCurrentPositionAsync,
        );
        expect(existingLocationModule.requestForegroundPermissionsAsync).toBeFunction();
        expect(existingLocationModule.default).toBe('keep-location-default');
        expect(existingLocationModule.__esModule).toBe(true);
        expect(existingSensorsModule.Accelerometer).toBe(existingAccelerometer);
        expect(existingSensorsModule.Gyroscope).toBeDefined();
        expect(existingSensorsModule.default).toBe('keep-sensors-default');
        expect(existingSensorsModule.__esModule).toBe(true);
    });
});

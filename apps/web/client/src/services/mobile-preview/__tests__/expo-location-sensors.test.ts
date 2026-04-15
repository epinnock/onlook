import { describe, expect, test } from 'bun:test';

const installExpoLocationSensorsShim = require('../../../../../../../packages/mobile-preview/runtime/shims/expo/location-sensors.js');

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
        const target = {};

        const installed = installExpoLocationSensorsShim(target);
        const locationModule =
            target[RUNTIME_SHIM_REGISTRY_KEY][LOCATION_MODULE_ID];
        const sensorsModule =
            target[RUNTIME_SHIM_REGISTRY_KEY][SENSORS_MODULE_ID];

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
        const locationEvents = [];
        const headingEvents = [];
        const accelerometerEvents = [];
        const stepEvents = [];

        const positionSubscription = await location.watchPositionAsync(
            {},
            (reading) => {
                locationEvents.push(reading);
            },
        );
        const headingSubscription = await location.watchHeadingAsync(
            (reading) => {
                headingEvents.push(reading);
            },
        );
        const accelerometerSubscription = sensors.Accelerometer.addListener(
            (reading) => {
                accelerometerEvents.push(reading);
            },
        );
        const pedometerSubscription = sensors.Pedometer.watchStepCount(
            (reading) => {
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
        const existingLocationModule = {
            default: 'keep-location-default',
            getCurrentPositionAsync: customGetCurrentPositionAsync,
        };
        const existingAccelerometer = {
            addListener: () => ({ remove() {} }),
        };
        const existingSensorsModule = {
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

        expect(installed.location).toBe(existingLocationModule);
        expect(installed.sensors).toBe(existingSensorsModule);
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

import { describe, expect, test } from 'bun:test';

const installDeviceMetadataShim = require('../../../../../../../packages/mobile-preview/runtime/shims/expo/device-metadata.js');

const {
    APP_OWNERSHIP,
    BATTERY_STATE,
    DEVICE_TYPE,
    EXECUTION_ENVIRONMENT,
    MODULE_IDS,
    NETWORK_STATE_TYPE,
    RUNTIME_SHIM_REGISTRY_KEY,
} = installDeviceMetadataShim;

type RuntimeTarget = {
    __onlookShims?: Record<string, Record<string, unknown>>;
    __turboModuleProxy?: ((moduleId: string) => unknown) | Record<string, unknown>;
    nativeModuleProxy?: Record<string, unknown>;
};

describe('expo device metadata shim group', () => {
    test('installs expo-constants, expo-device, expo-network, and expo-battery into __onlookShims', async () => {
        const target: RuntimeTarget = {};

        const installedModules = installDeviceMetadataShim(target);
        const runtimeShims = target[RUNTIME_SHIM_REGISTRY_KEY] ?? {};
        const constantsModule = runtimeShims[MODULE_IDS.constants];
        const deviceModule = runtimeShims[MODULE_IDS.device];
        const networkModule = runtimeShims[MODULE_IDS.network];
        const batteryModule = runtimeShims[MODULE_IDS.battery];

        expect(Object.keys(installedModules).sort()).toEqual(
            Object.values(MODULE_IDS).sort(),
        );

        expect(installedModules[MODULE_IDS.constants]).toBe(constantsModule);
        expect(installedModules[MODULE_IDS.device]).toBe(deviceModule);
        expect(installedModules[MODULE_IDS.network]).toBe(networkModule);
        expect(installedModules[MODULE_IDS.battery]).toBe(batteryModule);

        expect(constantsModule.default.expoConfig).toEqual({
            name: 'Onlook Preview',
            platforms: ['ios', 'android'],
            scheme: 'onlook-preview',
            slug: 'onlook-preview',
            version: '1.0.0',
        });
        expect(constantsModule.default.appOwnership).toBe(APP_OWNERSHIP.Expo);
        expect(constantsModule.default.executionEnvironment).toBe(
            EXECUTION_ENVIRONMENT.StoreClient,
        );
        expect(constantsModule.AppOwnership.Expo).toBe(APP_OWNERSHIP.Expo);
        expect(constantsModule.default.getWebViewUserAgentAsync()).resolves.toBeNull();

        expect(deviceModule.default).toBe(deviceModule);
        expect(deviceModule.__esModule).toBe(true);
        expect(deviceModule.DeviceType.PHONE).toBe(DEVICE_TYPE.PHONE);
        expect(deviceModule.modelName).toBe('iPhone');
        expect(deviceModule.osName).toBe('iOS');
        expect(deviceModule.isDevice).toBe(true);
        expect(await deviceModule.getDeviceTypeAsync()).toBe(DEVICE_TYPE.PHONE);
        expect(await deviceModule.getPlatformFeaturesAsync()).toEqual([]);
        expect(await deviceModule.isRootedExperimentalAsync()).toBe(false);

        expect(networkModule.default).toBe(networkModule);
        expect(networkModule.NetworkStateType.WIFI).toBe(NETWORK_STATE_TYPE.WIFI);
        expect(await networkModule.getNetworkStateAsync()).toEqual({
            isConnected: true,
            isInternetReachable: true,
            type: NETWORK_STATE_TYPE.WIFI,
        });
        expect(await networkModule.getIpAddressAsync()).toBe('0.0.0.0');
        expect(await networkModule.isAirplaneModeEnabledAsync()).toBe(false);
        expect(networkModule.useNetworkState()).toEqual({
            isConnected: true,
            isInternetReachable: true,
            type: NETWORK_STATE_TYPE.WIFI,
        });
        expect(networkModule.addNetworkStateListener(() => undefined).remove).toBeFunction();

        expect(batteryModule.default).toBe(batteryModule);
        expect(batteryModule.BatteryState.FULL).toBe(BATTERY_STATE.FULL);
        expect(await batteryModule.isAvailableAsync()).toBe(true);
        expect(await batteryModule.getBatteryLevelAsync()).toBe(1);
        expect(await batteryModule.getBatteryStateAsync()).toBe(BATTERY_STATE.FULL);
        expect(await batteryModule.getPowerStateAsync()).toEqual({
            batteryLevel: 1,
            batteryState: BATTERY_STATE.FULL,
            lowPowerMode: false,
        });
        expect(batteryModule.usePowerState()).toEqual({
            batteryLevel: 1,
            batteryState: BATTERY_STATE.FULL,
            lowPowerMode: false,
        });
        expect(batteryModule.addBatteryLevelListener(() => undefined).remove).toBeFunction();
    });

    test('hydrates the grouped modules from native metadata when present', async () => {
        const target: RuntimeTarget = {
            __turboModuleProxy(moduleId) {
                switch (moduleId) {
                    case 'ExpoBattery':
                        return {
                            batteryLevel: 0.42,
                            batteryState: BATTERY_STATE.CHARGING,
                            getBatteryLevelAsync: async () => 0.42,
                            getBatteryStateAsync: async () =>
                                BATTERY_STATE.CHARGING,
                            getPowerStateAsync: async () => ({
                                batteryLevel: 0.42,
                                batteryState: BATTERY_STATE.CHARGING,
                                lowPowerMode: true,
                            }),
                            isAvailableAsync: async () => true,
                            isLowPowerModeEnabledAsync: async () => true,
                            lowPowerMode: true,
                        };
                    case 'ExpoDevice':
                        return {
                            brand: 'Google',
                            deviceName: 'Pixel Preview',
                            deviceType: DEVICE_TYPE.PHONE,
                            getDeviceTypeAsync: async () => DEVICE_TYPE.PHONE,
                            getPlatformFeaturesAsync: async () => [
                                'android.hardware.camera',
                            ],
                            hasPlatformFeatureAsync: async (feature: string) =>
                                feature === 'android.hardware.camera',
                            isDevice: true,
                            manufacturer: 'Google',
                            modelName: 'Pixel 9',
                            osName: 'Android',
                            osVersion: '15',
                            platformFeatures: ['android.hardware.camera'],
                        };
                    case 'ExpoNetwork':
                        return {
                            getIpAddressAsync: async () => '10.0.0.42',
                            getNetworkStateAsync: async () => ({
                                isConnected: true,
                                isInternetReachable: true,
                                type: NETWORK_STATE_TYPE.CELLULAR,
                            }),
                            ipAddress: '10.0.0.42',
                            isConnected: true,
                            isInternetReachable: true,
                            type: NETWORK_STATE_TYPE.CELLULAR,
                        };
                    default:
                        return null;
                }
            },
            nativeModuleProxy: {
                ExponentConstants: {
                    appOwnership: null,
                    executionEnvironment: EXECUTION_ENVIRONMENT.Bare,
                    expoConfig: {
                        name: 'Demo App',
                        slug: 'demo-app',
                        version: '2.0.0',
                    },
                    getWebViewUserAgentAsync: async () => 'PreviewAgent/1.0',
                    linkingUri: 'demo://preview',
                    sessionId: 'demo-session',
                    statusBarHeight: 47,
                    systemFonts: ['SF Pro Text'],
                },
            },
        };

        installDeviceMetadataShim(target);

        const runtimeShims = target[RUNTIME_SHIM_REGISTRY_KEY] ?? {};
        const constantsModule = runtimeShims[MODULE_IDS.constants];
        const deviceModule = runtimeShims[MODULE_IDS.device];
        const networkModule = runtimeShims[MODULE_IDS.network];
        const batteryModule = runtimeShims[MODULE_IDS.battery];

        expect(constantsModule.default.appOwnership).toBeNull();
        expect(constantsModule.default.executionEnvironment).toBe(
            EXECUTION_ENVIRONMENT.Bare,
        );
        expect(constantsModule.default.expoConfig).toEqual({
            name: 'Demo App',
            slug: 'demo-app',
            version: '2.0.0',
        });
        expect(constantsModule.default.linkingUri).toBe('demo://preview');
        expect(constantsModule.default.sessionId).toBe('demo-session');
        expect(await constantsModule.default.getWebViewUserAgentAsync()).toBe(
            'PreviewAgent/1.0',
        );

        expect(deviceModule.brand).toBe('Google');
        expect(deviceModule.manufacturer).toBe('Google');
        expect(deviceModule.modelName).toBe('Pixel 9');
        expect(deviceModule.osName).toBe('Android');
        expect(deviceModule.osVersion).toBe('15');
        expect(await deviceModule.getPlatformFeaturesAsync()).toEqual([
            'android.hardware.camera',
        ]);
        expect(
            await deviceModule.hasPlatformFeatureAsync(
                'android.hardware.camera',
            ),
        ).toBe(true);

        expect(await networkModule.getNetworkStateAsync()).toEqual({
            isConnected: true,
            isInternetReachable: true,
            type: NETWORK_STATE_TYPE.CELLULAR,
        });
        expect(networkModule.useNetworkState()).toEqual({
            isConnected: true,
            isInternetReachable: true,
            type: NETWORK_STATE_TYPE.CELLULAR,
        });
        expect(await networkModule.getIpAddressAsync()).toBe('10.0.0.42');

        expect(await batteryModule.getBatteryLevelAsync()).toBe(0.42);
        expect(await batteryModule.getBatteryStateAsync()).toBe(
            BATTERY_STATE.CHARGING,
        );
        expect(await batteryModule.isLowPowerModeEnabledAsync()).toBe(true);
        expect(batteryModule.usePowerState()).toEqual({
            batteryLevel: 0.42,
            batteryState: BATTERY_STATE.CHARGING,
            lowPowerMode: true,
        });
    });

    test('merges into existing registry entries without overwriting custom exports', () => {
        const existingConstantsDefault = { expoConfig: { slug: 'custom' } };
        const target: RuntimeTarget = {
            __onlookShims: {
                'expo-battery': {
                    customBatteryFlag: true,
                },
                'expo-constants': {
                    default: existingConstantsDefault,
                },
                'expo-device': {
                    customDeviceFlag: true,
                },
                'expo-network': {
                    customNetworkFlag: true,
                },
            },
        };

        installDeviceMetadataShim(target);

        const runtimeShims = target[RUNTIME_SHIM_REGISTRY_KEY] ?? {};

        expect(runtimeShims['expo-constants'].default).toBe(
            existingConstantsDefault,
        );
        expect(runtimeShims['expo-constants'].AppOwnership).toEqual(
            APP_OWNERSHIP,
        );
        expect(runtimeShims['expo-device'].customDeviceFlag).toBe(true);
        expect(runtimeShims['expo-device'].getDeviceTypeAsync).toBeFunction();
        expect(runtimeShims['expo-device'].default).toBe(
            runtimeShims['expo-device'],
        );
        expect(runtimeShims['expo-network'].customNetworkFlag).toBe(true);
        expect(runtimeShims['expo-network'].getNetworkStateAsync).toBeFunction();
        expect(runtimeShims['expo-battery'].customBatteryFlag).toBe(true);
        expect(runtimeShims['expo-battery'].getPowerStateAsync).toBeFunction();
    });
});

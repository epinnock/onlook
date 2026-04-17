import { afterEach, describe, expect, test } from 'bun:test';
import React from 'react';

const nativeModulesShim = require('../shims/core/native-modules.js') as {
    NATIVE_MODULE_BRIDGE_GLOBAL_KEY: string;
    REACT_NATIVE_MODULE_ID: string;
    RUNTIME_SHIM_REGISTRY_KEY: string;
    install: (target: RuntimeTarget) => NativeModuleBridge;
};

const reactNativeShim = require('../shims/core/react-native.js') as {
    install: (target: RuntimeTarget) => Record<string, unknown>;
};

const {
    NATIVE_MODULE_BRIDGE_GLOBAL_KEY,
    REACT_NATIVE_MODULE_ID,
    RUNTIME_SHIM_REGISTRY_KEY,
} = nativeModulesShim;

interface NativeModuleBridge {
    NativeModules: Record<string, unknown>;
    TurboModuleRegistry: {
        get: (name: string) => unknown;
        getEnforcing: (name: string) => unknown;
    };
    resolveNativeModule: (name: string) => unknown;
    resolveTurboModule: (name: string) => unknown;
}

interface RuntimeTarget extends Record<string, unknown> {
    NativeModules?: Record<string, unknown>;
    React?: typeof React;
    TurboModuleRegistry?: NativeModuleBridge['TurboModuleRegistry'];
    __onlookNativeModuleBridge?: NativeModuleBridge;
    __turboModuleProxy?: ((name: string) => unknown) | Record<string, unknown>;
    nativeModuleProxy?: Record<string, unknown>;
}

type GlobalSnapshot = Map<string, unknown>;

const RUNTIME_GLOBAL_KEYS = [
    'NativeModules',
    'React',
    'RawText',
    'Text',
    'TextC',
    'TurboModuleRegistry',
    'View',
    '__onlookNativeModuleBridge',
    '__onlookShims',
    '__turboModuleProxy',
    '_initReconciler',
    '_log',
    'createElement',
    'nativeModuleProxy',
    'renderApp',
    'useCallback',
    'useEffect',
    'useMemo',
    'useRef',
    'useState',
] as const;

function createRuntimeTarget(overrides: Partial<RuntimeTarget> = {}): RuntimeTarget {
    return {
        React,
        nativeModuleProxy: {},
        __turboModuleProxy: () => null,
        ...overrides,
    };
}

function snapshotRuntimeGlobals(): GlobalSnapshot {
    const snapshot = new Map<string, unknown>();
    const runtimeGlobal = globalThis as Record<string, unknown>;

    for (const key of RUNTIME_GLOBAL_KEYS) {
        snapshot.set(key, runtimeGlobal[key]);
    }

    return snapshot;
}

function restoreRuntimeGlobals(snapshot: GlobalSnapshot) {
    const runtimeGlobal = globalThis as Record<string, unknown>;

    for (const key of RUNTIME_GLOBAL_KEYS) {
        const value = snapshot.get(key);

        if (typeof value === 'undefined') {
            delete runtimeGlobal[key];
        } else {
            runtimeGlobal[key] = value;
        }
    }
}

function clearRuntimeModuleCache() {
    delete require.cache[require.resolve('../runtime.js')];
}

afterEach(() => {
    clearRuntimeModuleCache();
});

describe('native modules bridge shim', () => {
    test('installs a stable passthrough bridge over nativeModuleProxy and __turboModuleProxy', () => {
        const constantsModule = { appOwnership: 'expo' };
        const clipboardModule = { getStringAsync: () => 'copied' };
        const turboCameraModule = { capture: () => 'turbo-camera' };
        const target = createRuntimeTarget({
            nativeModuleProxy: {
                ExponentConstants: constantsModule,
            },
            __turboModuleProxy(name: string) {
                switch (name) {
                    case 'ExpoClipboard':
                        return clipboardModule;
                    case 'ExponentCamera':
                        return turboCameraModule;
                    default:
                        return null;
                }
            },
        });

        const bridge = nativeModulesShim.install(target);
        const installedReactNativeModule = target[RUNTIME_SHIM_REGISTRY_KEY] as Record<string, unknown>;

        expect(target[NATIVE_MODULE_BRIDGE_GLOBAL_KEY]).toBe(bridge);
        expect(target.NativeModules).toBe(bridge.NativeModules);
        expect(target.TurboModuleRegistry).toBe(bridge.TurboModuleRegistry);
        expect(bridge.NativeModules.ExponentConstants).toBe(constantsModule);
        expect(bridge.NativeModules.ExpoClipboard).toBe(clipboardModule);
        expect(bridge.TurboModuleRegistry.get('ExpoClipboard')).toBe(clipboardModule);
        expect(bridge.TurboModuleRegistry.get('ExponentCamera')).toBe(turboCameraModule);
        expect(bridge.resolveNativeModule('ExponentConstants')).toBe(constantsModule);
        expect(bridge.resolveTurboModule('ExpoClipboard')).toBe(clipboardModule);
        expect('ExponentConstants' in bridge.NativeModules).toBe(true);
        expect('MissingModule' in bridge.NativeModules).toBe(false);
        expect(Object.keys(bridge.NativeModules)).toEqual(['ExponentConstants']);
        expect(installedReactNativeModule[REACT_NATIVE_MODULE_ID]).toMatchObject({
            NativeModules: bridge.NativeModules,
            TurboModuleRegistry: bridge.TurboModuleRegistry,
            __esModule: true,
        });
        expect(() => bridge.TurboModuleRegistry.getEnforcing('MissingModule')).toThrow(
            'TurboModule "MissingModule" not found',
        );
    });

    test('merges the bridge into the core react-native shim entry before runtime hydration', () => {
        const constantsModule = { appOwnership: 'expo' };
        const target = createRuntimeTarget({
            nativeModuleProxy: {
                ExponentConstants: constantsModule,
            },
        });

        const bridge = nativeModulesShim.install(target);
        const reactNativeModule = reactNativeShim.install(target) as Record<string, unknown>;

        expect(reactNativeModule.NativeModules).toBe(bridge.NativeModules);
        expect(reactNativeModule.TurboModuleRegistry).toBe(bridge.TurboModuleRegistry);
        expect(reactNativeModule.View).toBe('View');
        expect(reactNativeModule.default).toBe(reactNativeModule);
        expect(reactNativeModule.__esModule).toBe(true);
    });
});

describe('runtime native modules wiring', () => {
    test('reuses the shim bridge for runtime globals and exports', () => {
        const snapshot = snapshotRuntimeGlobals();
        const runtimeGlobal = globalThis as Record<string, unknown>;
        const constantsModule = { appOwnership: 'expo' };
        const expoDeviceModule = { getDeviceName: () => 'Preview Phone' };

        runtimeGlobal._log = () => {};
        runtimeGlobal.nativeModuleProxy = {
            ExponentConstants: constantsModule,
        };
        runtimeGlobal.__turboModuleProxy = (name: string) =>
            name === 'ExpoDevice' ? expoDeviceModule : null;
        runtimeGlobal[RUNTIME_SHIM_REGISTRY_KEY] = {};

        try {
            const runtimeModule = require('../runtime.js') as {
                NativeModules: Record<string, unknown>;
                React: typeof React;
                TurboModuleRegistry: NativeModuleBridge['TurboModuleRegistry'];
            };
            const reactNativeModule = (
                runtimeGlobal[RUNTIME_SHIM_REGISTRY_KEY] as Record<string, Record<string, unknown>>
            )[REACT_NATIVE_MODULE_ID];

            expect(runtimeModule.React).toBe(React);
            expect(runtimeModule.NativeModules).toBe(runtimeGlobal.NativeModules);
            expect(runtimeModule.TurboModuleRegistry).toBe(runtimeGlobal.TurboModuleRegistry);
            expect(runtimeGlobal.NativeModules).toMatchObject({
                ExponentConstants: constantsModule,
            });
            expect(runtimeGlobal.NativeModules.ExponentConstants).toBe(constantsModule);
            expect(runtimeGlobal.TurboModuleRegistry.get('ExpoDevice')).toBe(expoDeviceModule);
            expect(reactNativeModule.NativeModules).toBe(runtimeGlobal.NativeModules);
            expect(reactNativeModule.TurboModuleRegistry).toBe(runtimeGlobal.TurboModuleRegistry);
        } finally {
            restoreRuntimeGlobals(snapshot);
        }
    });
});

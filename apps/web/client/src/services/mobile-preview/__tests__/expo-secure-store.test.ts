import { afterEach, describe, expect, test } from 'bun:test';

const installExpoSecureStoreShim = require('../../../../../../../packages/mobile-preview/runtime/shims/expo/expo-secure-store.js');
const expoRuntimeShimCollection = require('../../../../../../../packages/mobile-preview/runtime/shims/expo/index.js');
const {
    applyRuntimeShims,
    getRegisteredRuntimeShimIds,
    registerRuntimeShim,
    resetRuntimeShimRegistry,
} = require('../../../../../../../packages/mobile-preview/runtime/registry.js');

const {
    KEYCHAIN_ACCESSIBILITY_CONSTANTS,
    MODULE_ID,
    RUNTIME_SHIM_REGISTRY_KEY,
    SECURE_STORE_STATE_KEY,
} = installExpoSecureStoreShim;

afterEach(() => {
    resetRuntimeShimRegistry();
});

describe('expo-secure-store shim', () => {
    test('installs the module into __onlookShims', async () => {
        const target = {};

        const moduleExports = installExpoSecureStoreShim(target);

        expect(target[RUNTIME_SHIM_REGISTRY_KEY][MODULE_ID]).toBe(moduleExports);
        expect(moduleExports.default).toBe(moduleExports);
        expect(moduleExports.__esModule).toBe(true);
        expect(await moduleExports.isAvailableAsync()).toBe(true);
        expect(moduleExports.canUseBiometricAuthentication()).toBe(false);

        for (const [key, value] of Object.entries(KEYCHAIN_ACCESSIBILITY_CONSTANTS)) {
            expect(moduleExports[key]).toBe(value);
        }
    });

    test('persists values across async and sync helpers on the target store', async () => {
        const target = {};
        const moduleExports = installExpoSecureStoreShim(target);

        await moduleExports.setItemAsync('session-token', 'abc123');
        expect(await moduleExports.getItemAsync('session-token')).toBe('abc123');
        expect(moduleExports.getItem('session-token')).toBe('abc123');

        moduleExports.setItem('refresh-token', 'def456');
        expect(await moduleExports.getItemAsync('refresh-token')).toBe('def456');
        expect(target[SECURE_STORE_STATE_KEY]).toBeInstanceOf(Map);
        expect(target[SECURE_STORE_STATE_KEY].get('session-token')).toBe('abc123');

        await moduleExports.deleteItemAsync('session-token');
        expect(await moduleExports.getItemAsync('session-token')).toBeNull();

        moduleExports.deleteItem('refresh-token');
        expect(moduleExports.getItem('refresh-token')).toBeNull();
    });

    test('merges into an existing expo-secure-store registry entry', async () => {
        const existingGetItemAsync = async () => 'persisted';
        const target = {
            __onlookShims: {
                'expo-secure-store': {
                    getItemAsync: existingGetItemAsync,
                },
            },
        };

        const moduleExports = installExpoSecureStoreShim(target);

        expect(moduleExports).toBe(target.__onlookShims['expo-secure-store']);
        expect(moduleExports.getItemAsync).toBe(existingGetItemAsync);
        expect(moduleExports.setItemAsync).toBeFunction();
        expect(moduleExports.getItem).toBeFunction();
        expect(moduleExports.default).toBe(moduleExports);
        expect(moduleExports.__esModule).toBe(true);
        expect(await moduleExports.getItemAsync('ignored')).toBe('persisted');
    });
});

describe('expo-secure-store runtime shim auto-discovery', () => {
    test('derives the shim id from the Expo shim collection', async () => {
        registerRuntimeShim(
            installExpoSecureStoreShim,
            './shims/expo/expo-secure-store.js',
        );
        registerRuntimeShim(expoRuntimeShimCollection, './shims/expo/index.js');

        const target = {};
        applyRuntimeShims(target);

        expect(getRegisteredRuntimeShimIds()).toEqual(['expo-secure-store']);
        expect(target.__onlookShims?.['expo-secure-store']).toBeDefined();
        expect(
            await target.__onlookShims?.['expo-secure-store']?.getItemAsync(
                'missing',
            ),
        ).toBeNull();
    });
});

import { describe, expect, test } from 'bun:test';

const installExpoStatusBarShim = require('../../../../../../../packages/mobile-preview/runtime/shims/expo/expo-status-bar.js');

const { MODULE_ID, RUNTIME_SHIM_REGISTRY_KEY } = installExpoStatusBarShim as {
    MODULE_ID: string;
    RUNTIME_SHIM_REGISTRY_KEY: '__onlookShims';
};

type ShimTarget = {
    __onlookShims?: Record<string, Record<string, unknown>>;
};

describe('expo-status-bar shim', () => {
    test('installs the module into __onlookShims', () => {
        const target: ShimTarget = {};

        const moduleExports = installExpoStatusBarShim(target);

        expect(target[RUNTIME_SHIM_REGISTRY_KEY]?.[MODULE_ID]).toBe(moduleExports);
        expect(moduleExports.default).toBe(moduleExports.StatusBar);
        expect(moduleExports.__esModule).toBe(true);
        expect(moduleExports.StatusBar()).toBeNull();
    });

    test('exposes preview-safe no-op status bar helpers', () => {
        const moduleExports = installExpoStatusBarShim({});

        expect(moduleExports.setStatusBarStyle('light')).toBeUndefined();
        expect(moduleExports.setStatusBarHidden(true)).toBeUndefined();
        expect(moduleExports.setStatusBarBackgroundColor('#000000')).toBeUndefined();
        expect(moduleExports.setStatusBarTranslucent(true)).toBeUndefined();
    });

    test('merges into an existing expo-status-bar registry entry', () => {
        const existingStatusBar = Symbol('StatusBar');
        const target = {
            __onlookShims: {
                'expo-status-bar': {
                    StatusBar: existingStatusBar,
                },
            },
        };

        const moduleExports = installExpoStatusBarShim(target);

        expect(moduleExports).toBe(target.__onlookShims['expo-status-bar']);
        expect(moduleExports.StatusBar).toBe(existingStatusBar);
        expect(moduleExports.setStatusBarStyle).toBeFunction();
        expect(moduleExports.default).toBe(existingStatusBar);
        expect(moduleExports.__esModule).toBe(true);
    });
});

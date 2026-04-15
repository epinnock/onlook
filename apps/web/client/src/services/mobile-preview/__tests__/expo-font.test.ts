import { afterEach, describe, expect, test } from 'bun:test';

const installExpoFontShim = require('../../../../../../../packages/mobile-preview/runtime/shims/expo/expo-font.js');
const expoRuntimeShimCollection = require('../../../../../../../packages/mobile-preview/runtime/shims/expo/index.js');
const {
    applyRuntimeShims,
    getRegisteredRuntimeShimIds,
    registerRuntimeShim,
    resetRuntimeShimRegistry,
} = require('../../../../../../../packages/mobile-preview/runtime/registry.js');

const { MODULE_ID, RUNTIME_SHIM_REGISTRY_KEY } = installExpoFontShim;

afterEach(() => {
    resetRuntimeShimRegistry();
});

describe('expo-font shim', () => {
    test('installs the module into __onlookShims with preview-safe font helpers', async () => {
        const target = {};

        const moduleExports = installExpoFontShim(target);

        expect(target[RUNTIME_SHIM_REGISTRY_KEY][MODULE_ID]).toBe(moduleExports);
        expect(moduleExports.default).toBe(moduleExports);
        expect(moduleExports.__esModule).toBe(true);
        expect(moduleExports.useFonts({ Inter: 'mock-font' })).toEqual([
            true,
            null,
        ]);
        expect(moduleExports.isLoaded('Inter')).toBe(true);
        expect(moduleExports.isLoading('Inter')).toBe(false);
        expect(moduleExports.getLoadedFonts()).toEqual(['Inter']);

        await expect(moduleExports.loadAsync('SpaceMono', 'mock-font')).resolves.toBe(
            undefined,
        );
        expect(moduleExports.isLoaded('SpaceMono')).toBe(true);
        expect(moduleExports.getLoadedFonts()).toEqual(['Inter', 'SpaceMono']);

        await expect(
            moduleExports.renderToImageAsync('Hello', { fontFamily: 'Inter' }),
        ).resolves.toEqual({
            uri: 'data:text/plain,Hello',
            width: 0,
            height: 0,
            scale: 1,
        });

        await expect(moduleExports.unloadAsync('Inter')).resolves.toBe(undefined);
        expect(moduleExports.isLoaded('Inter')).toBe(false);

        await expect(moduleExports.unloadAllAsync()).resolves.toBe(undefined);
        expect(moduleExports.getLoadedFonts()).toEqual([]);
        expect(moduleExports.FontDisplay).toEqual({
            AUTO: 'auto',
            SWAP: 'swap',
            BLOCK: 'block',
            FALLBACK: 'fallback',
            OPTIONAL: 'optional',
        });
    });

    test('merges into an existing expo-font registry entry', () => {
        const existingUseFonts = () => [true, null];
        const target = {
            __onlookShims: {
                'expo-font': {
                    useFonts: existingUseFonts,
                },
            },
        };

        const moduleExports = installExpoFontShim(target);

        expect(moduleExports).toBe(target.__onlookShims['expo-font']);
        expect(moduleExports.useFonts).toBe(existingUseFonts);
        expect(moduleExports.loadAsync).toBeFunction();
        expect(moduleExports.getLoadedFonts).toBeFunction();
        expect(moduleExports.default).toBe(moduleExports);
        expect(moduleExports.__esModule).toBe(true);
    });

    test('auto-discovers the expo-font shim id from the expo collection', () => {
        const applied: string[] = [];

        registerRuntimeShim(installExpoFontShim, './shims/expo/expo-font.js');
        registerRuntimeShim(expoRuntimeShimCollection, './shims/expo/index.js');

        applyRuntimeShims({
            applied,
            __onlookShims: {},
        });

        expect(getRegisteredRuntimeShimIds()).toEqual(['expo-font']);
    });
});

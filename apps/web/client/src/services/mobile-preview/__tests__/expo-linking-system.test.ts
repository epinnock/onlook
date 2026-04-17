import { describe, expect, test } from 'bun:test';

const installExpoLinkingSystemShims = require('../../../../../../../packages/mobile-preview/runtime/shims/expo/linking-system.js');

const { MODULE_IDS, RUNTIME_SHIM_REGISTRY_KEY } = installExpoLinkingSystemShims;

describe('expo linking/system/splash shim group', () => {
    test('installs expo-linking, expo-system-ui, and expo-splash-screen into __onlookShims', async () => {
        const target = {};

        const installedModules = installExpoLinkingSystemShims(target);
        const registry = target[
            RUNTIME_SHIM_REGISTRY_KEY
        ] as Record<string, Record<string, unknown>>;
        const expoLinking = registry[MODULE_IDS.expoLinking];
        const expoSystemUI = registry[MODULE_IDS.expoSystemUI];
        const expoSplashScreen = registry[MODULE_IDS.expoSplashScreen];

        expect(installedModules.expoLinking).toBe(expoLinking);
        expect(installedModules.expoSystemUI).toBe(expoSystemUI);
        expect(installedModules.expoSplashScreen).toBe(expoSplashScreen);
        expect(expoLinking.default).toBe(expoLinking);
        expect(expoSystemUI.default).toBe(expoSystemUI);
        expect(expoSplashScreen.default).toBe(expoSplashScreen);
        expect(expoLinking.__esModule).toBe(true);
        expect(expoSystemUI.__esModule).toBe(true);
        expect(expoSplashScreen.__esModule).toBe(true);

        const createdUrl = expoLinking.createURL('settings/profile', {
            queryParams: {
                hello: 'world',
                multi: ['one', 'two'],
            },
            scheme: 'scry-preview',
        });

        expect(createdUrl).toBe(
            'scry-preview://settings/profile?hello=world&multi=one&multi=two',
        );
        expect(expoLinking.parse(createdUrl)).toEqual({
            hostname: null,
            path: 'settings/profile',
            queryParams: {
                hello: 'world',
                multi: ['one', 'two'],
            },
            scheme: 'scry-preview',
        });
        expect(expoLinking.useURL()).toBeNull();
        expect(expoLinking.useLinkingURL()).toBeNull();
        expect(expoLinking.getLinkingURL()).toBeNull();
        expect(expoLinking.collectManifestSchemes()).toEqual([
            'onlook-preview',
        ]);
        expect(expoLinking.resolveScheme({ scheme: 'custom' })).toBe('custom');
        expect(expoLinking.hasConstantsManifest()).toBe(false);
        expect(expoLinking.hasCustomScheme()).toBe(true);
        expect(expoLinking.addEventListener('url', () => undefined)).toEqual({
            remove: expect.any(Function),
        });
        await expect(expoLinking.getInitialURL()).resolves.toBeNull();
        await expect(expoLinking.parseInitialURLAsync()).resolves.toEqual({
            hostname: null,
            path: null,
            queryParams: null,
            scheme: null,
        });
        await expect(expoLinking.canOpenURL('https://expo.dev')).resolves.toBe(
            true,
        );
        await expect(expoLinking.canOpenURL('')).resolves.toBe(false);
        await expect(expoLinking.openURL('https://expo.dev')).resolves.toBe(
            true,
        );
        await expect(expoLinking.openSettings()).resolves.toBeUndefined();
        await expect(expoLinking.sendIntent('VIEW')).resolves.toBeUndefined();

        await expect(expoSystemUI.getBackgroundColorAsync()).resolves.toBeNull();
        await expect(
            expoSystemUI.setBackgroundColorAsync('#101010'),
        ).resolves.toBeUndefined();
        await expect(expoSystemUI.getBackgroundColorAsync()).resolves.toBe(
            '#101010',
        );

        expect(expoSplashScreen.hide()).toBeUndefined();
        expect(
            expoSplashScreen.setOptions({ duration: 200, fade: true }),
        ).toBeUndefined();
        await expect(
            expoSplashScreen.preventAutoHideAsync(),
        ).resolves.toBe(true);
        await expect(
            expoSplashScreen.preventAutoHideAsync(),
        ).resolves.toBe(false);
        await expect(expoSplashScreen.hideAsync()).resolves.toBeUndefined();
    });

    test('merges into existing registry entries without overwriting existing exports', async () => {
        const target = {
            __onlookShims: {
                'expo-linking': {
                    ExistingLinking: 'linking',
                },
                'expo-system-ui': {
                    ExistingSystemUI: 'system-ui',
                },
                'expo-splash-screen': {
                    ExistingSplashScreen: 'splash-screen',
                },
            },
        };

        const installedModules = installExpoLinkingSystemShims(target);
        const registry = target.__onlookShims as Record<
            string,
            Record<string, unknown>
        >;

        expect(installedModules.expoLinking).toBe(registry['expo-linking']);
        expect(installedModules.expoSystemUI).toBe(registry['expo-system-ui']);
        expect(installedModules.expoSplashScreen).toBe(
            registry['expo-splash-screen'],
        );
        expect(registry['expo-linking'].ExistingLinking).toBe('linking');
        expect(registry['expo-system-ui'].ExistingSystemUI).toBe('system-ui');
        expect(registry['expo-splash-screen'].ExistingSplashScreen).toBe(
            'splash-screen',
        );
        expect(registry['expo-linking'].createURL).toBeFunction();
        expect(registry['expo-system-ui'].setBackgroundColorAsync).toBeFunction();
        expect(
            registry['expo-splash-screen'].preventAutoHideAsync,
        ).toBeFunction();
        expect(registry['expo-linking'].default).toBe(
            registry['expo-linking'],
        );
        expect(registry['expo-system-ui'].default).toBe(
            registry['expo-system-ui'],
        );
        expect(registry['expo-splash-screen'].default).toBe(
            registry['expo-splash-screen'],
        );
        expect(registry['expo-linking'].__esModule).toBe(true);
        expect(registry['expo-system-ui'].__esModule).toBe(true);
        expect(registry['expo-splash-screen'].__esModule).toBe(true);

        await expect(
            registry['expo-system-ui'].setBackgroundColorAsync('#222222'),
        ).resolves.toBeUndefined();
        await expect(
            registry['expo-system-ui'].getBackgroundColorAsync(),
        ).resolves.toBe('#222222');
    });
});

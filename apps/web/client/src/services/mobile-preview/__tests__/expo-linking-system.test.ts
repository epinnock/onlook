import { describe, expect, test } from 'bun:test';

// Shim module shape mirrors the JS installer's runtime output. Methods are
// declared as concrete (non-optional) properties so that `noUncheckedIndexedAccess`
// doesn't widen them to `T | undefined` at call sites. `unknown` arg/return
// types keep call sites loose without leaking `any`.
type Fn = (...args: unknown[]) => unknown;
type AsyncFn = (...args: unknown[]) => Promise<unknown>;

interface ExpoLinkingShim {
    createURL: Fn;
    parse: Fn;
    useURL: Fn;
    useLinkingURL: Fn;
    getLinkingURL: Fn;
    collectManifestSchemes: Fn;
    resolveScheme: Fn;
    hasConstantsManifest: Fn;
    hasCustomScheme: Fn;
    addEventListener: Fn;
    getInitialURL: AsyncFn;
    parseInitialURLAsync: AsyncFn;
    canOpenURL: AsyncFn;
    openURL: AsyncFn;
    openSettings: AsyncFn;
    sendIntent: AsyncFn;
    default: unknown;
    __esModule: boolean;
    [key: string]: unknown;
}

interface ExpoSystemUIShim {
    getBackgroundColorAsync: AsyncFn;
    setBackgroundColorAsync: AsyncFn;
    default: unknown;
    __esModule: boolean;
    [key: string]: unknown;
}

interface ExpoSplashScreenShim {
    hide: Fn;
    setOptions: Fn;
    preventAutoHideAsync: AsyncFn;
    hideAsync: AsyncFn;
    default: unknown;
    __esModule: boolean;
    [key: string]: unknown;
}

type LinkingSystemModuleIds = {
    expoLinking: string;
    expoSystemUI: string;
    expoSplashScreen: string;
};

type InstalledModules = {
    expoLinking: ExpoLinkingShim;
    expoSystemUI: ExpoSystemUIShim;
    expoSplashScreen: ExpoSplashScreenShim;
};

type ExpoLinkingSystemShimInstaller = {
    (target: Record<string, unknown>): InstalledModules;
    MODULE_IDS: LinkingSystemModuleIds;
    RUNTIME_SHIM_REGISTRY_KEY: string;
};

const installExpoLinkingSystemShims =
    require('../../../../../../../packages/mobile-preview/runtime/shims/expo/linking-system.js') as ExpoLinkingSystemShimInstaller;

const { MODULE_IDS, RUNTIME_SHIM_REGISTRY_KEY } = installExpoLinkingSystemShims;

describe('expo linking/system/splash shim group', () => {
    test('installs expo-linking, expo-system-ui, and expo-splash-screen into __onlookShims', async () => {
        const target: Record<string, unknown> = {};

        const installedModules = installExpoLinkingSystemShims(target);
        const registry = target[RUNTIME_SHIM_REGISTRY_KEY] as Record<
            string,
            unknown
        >;
        const expoLinking = registry[MODULE_IDS.expoLinking] as ExpoLinkingShim;
        const expoSystemUI = registry[
            MODULE_IDS.expoSystemUI
        ] as ExpoSystemUIShim;
        const expoSplashScreen = registry[
            MODULE_IDS.expoSplashScreen
        ] as ExpoSplashScreenShim;

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

        const installedModules = installExpoLinkingSystemShims(
            target as unknown as Record<string, unknown>,
        );
        const registry = target.__onlookShims as Record<string, unknown>;
        const linking = registry['expo-linking'] as ExpoLinkingShim & {
            ExistingLinking: string;
        };
        const systemUI = registry['expo-system-ui'] as ExpoSystemUIShim & {
            ExistingSystemUI: string;
        };
        const splashScreen = registry[
            'expo-splash-screen'
        ] as ExpoSplashScreenShim & { ExistingSplashScreen: string };

        expect(installedModules.expoLinking).toBe(linking);
        expect(installedModules.expoSystemUI).toBe(systemUI);
        expect(installedModules.expoSplashScreen).toBe(splashScreen);
        expect(linking.ExistingLinking).toBe('linking');
        expect(systemUI.ExistingSystemUI).toBe('system-ui');
        expect(splashScreen.ExistingSplashScreen).toBe('splash-screen');
        expect(linking.createURL).toBeFunction();
        expect(systemUI.setBackgroundColorAsync).toBeFunction();
        expect(splashScreen.preventAutoHideAsync).toBeFunction();
        expect(linking.default).toBe(linking);
        expect(systemUI.default).toBe(systemUI);
        expect(splashScreen.default).toBe(splashScreen);
        expect(linking.__esModule).toBe(true);
        expect(systemUI.__esModule).toBe(true);
        expect(splashScreen.__esModule).toBe(true);

        await expect(
            systemUI.setBackgroundColorAsync('#222222'),
        ).resolves.toBeUndefined();
        await expect(systemUI.getBackgroundColorAsync()).resolves.toBe(
            '#222222',
        );
    });
});

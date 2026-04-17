import { afterEach, describe, expect, test } from 'bun:test';

const installExpoNotificationsShim = require('../../../../../../../packages/mobile-preview/runtime/shims/expo/expo-notifications.js');
const expoRuntimeShimCollection = require('../../../../../../../packages/mobile-preview/runtime/shims/expo/index.js');
const {
    applyRuntimeShims,
    getRegisteredRuntimeShimIds,
    registerRuntimeShim,
    resetRuntimeShimRegistry,
} = require('../../../../../../../packages/mobile-preview/runtime/registry.js');

const {
    DEFAULT_ACTION_IDENTIFIER,
    MODULE_ID,
    RUNTIME_SHIM_REGISTRY_KEY,
} = installExpoNotificationsShim;

afterEach(() => {
    resetRuntimeShimRegistry();
});

describe('expo-notifications shim', () => {
    test('installs the module into __onlookShims with preview-safe async helpers', async () => {
        const target = {};

        const moduleExports = installExpoNotificationsShim(target);

        expect(target[RUNTIME_SHIM_REGISTRY_KEY][MODULE_ID]).toBe(moduleExports);
        expect(moduleExports.default).toBe(moduleExports);
        expect(moduleExports.__esModule).toBe(true);
        await expect(moduleExports.getPermissionsAsync()).resolves.toEqual({
            canAskAgain: true,
            expires: 'never',
            granted: true,
            status: 'granted',
        });

        const scheduledNotificationId =
            await moduleExports.scheduleNotificationAsync({
                content: {
                    body: 'Preview reminder',
                    title: 'Hello',
                },
                trigger: null,
            });

        expect(scheduledNotificationId).toBe('onlook-notification-1');
        await expect(
            moduleExports.getAllScheduledNotificationsAsync(),
        ).resolves.toEqual([
            {
                content: {
                    body: 'Preview reminder',
                    title: 'Hello',
                },
                identifier: 'onlook-notification-1',
                trigger: null,
            },
        ]);
    });

    test('provides stable listeners, token helpers, and foreground presentation stubs', async () => {
        const target = {};
        const moduleExports = installExpoNotificationsShim(target);
        const handledIdentifiers: string[] = [];
        const receivedNotifications: Array<{ request: { identifier: string } }> =
            [];
        const pushTokens: Array<{ data: string; type: string }> = [];

        moduleExports.setNotificationHandler({
            async handleNotification(notification: {
                request: { identifier: string };
            }) {
                handledIdentifiers.push(notification.request.identifier);

                return {
                    shouldPlaySound: false,
                    shouldSetBadge: true,
                    shouldShowBanner: true,
                    shouldShowList: true,
                };
            },
            handleSuccess(identifier: string) {
                handledIdentifiers.push(`success:${identifier}`);
            },
        });

        const receivedSubscription = moduleExports.addNotificationReceivedListener(
            (notification: { request: { identifier: string } }) => {
                receivedNotifications.push(notification);
            },
        );
        const pushTokenSubscription = moduleExports.addPushTokenListener(
            (token: { data: string; type: string }) => {
                pushTokens.push(token);
            },
        );

        await expect(
            moduleExports.getExpoPushTokenAsync({ projectId: 'demo-project' }),
        ).resolves.toEqual({
            data: 'ExponentPushToken[demo-project]',
            type: 'expo',
        });
        await expect(moduleExports.getDevicePushTokenAsync()).resolves.toEqual({
            data: 'onlook-device-push-token',
            type: 'ios',
        });

        const presentedNotificationId = await moduleExports.presentNotificationAsync(
            {
                badge: 7,
                body: 'Foreground body',
                title: 'Foreground title',
            },
        );

        expect(presentedNotificationId).toBe('onlook-notification-1');
        expect(handledIdentifiers).toEqual([
            'onlook-notification-1',
            'success:onlook-notification-1',
        ]);
        expect(receivedNotifications).toHaveLength(1);
        expect(receivedNotifications[0]).toMatchObject({
            request: {
                content: {
                    badge: 7,
                    body: 'Foreground body',
                    title: 'Foreground title',
                },
                identifier: 'onlook-notification-1',
                trigger: null,
            },
        });
        expect(pushTokens).toEqual([
            {
                data: 'ExponentPushToken[demo-project]',
                type: 'expo',
            },
            {
                data: 'onlook-device-push-token',
                type: 'ios',
            },
        ]);
        await expect(moduleExports.getBadgeCountAsync()).resolves.toBe(7);
        await expect(moduleExports.getPresentedNotificationsAsync()).resolves.toHaveLength(
            1,
        );

        receivedSubscription.remove();
        moduleExports.removePushTokenSubscription(pushTokenSubscription);

        await moduleExports.presentNotificationAsync({ title: 'No listener' });

        expect(receivedNotifications).toHaveLength(1);
    });

    test('merges into an existing expo-notifications registry entry', () => {
        const existingGetPermissionsAsync = async () => ({
            granted: false,
        });
        const target = {
            __onlookShims: {
                'expo-notifications': {
                    default: 'keep-default',
                    getPermissionsAsync: existingGetPermissionsAsync,
                },
            },
        };

        const moduleExports = installExpoNotificationsShim(target);

        expect(moduleExports).toBe(target.__onlookShims['expo-notifications']);
        expect(moduleExports.getPermissionsAsync).toBe(
            existingGetPermissionsAsync,
        );
        expect(moduleExports.presentNotificationAsync).toBeFunction();
        expect(moduleExports.DEFAULT_ACTION_IDENTIFIER).toBe(
            DEFAULT_ACTION_IDENTIFIER,
        );
        expect(moduleExports.default).toBe('keep-default');
        expect(moduleExports.__esModule).toBe(true);
    });

    test('auto-discovers the expo-notifications shim id from the expo collection', () => {
        registerRuntimeShim(
            installExpoNotificationsShim,
            './shims/expo/expo-notifications.js',
        );
        registerRuntimeShim(expoRuntimeShimCollection, './shims/expo/index.js');

        const target = {
            __onlookShims: {},
        };

        applyRuntimeShims(target);

        expect(getRegisteredRuntimeShimIds()).toEqual(['expo-notifications']);
        expect(target.__onlookShims[MODULE_ID]).toBeDefined();
        expect(target.__onlookShims[MODULE_ID].DEFAULT_ACTION_IDENTIFIER).toBe(
            DEFAULT_ACTION_IDENTIFIER,
        );
    });
});

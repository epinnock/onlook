import { describe, expect, test } from 'bun:test';
import React from 'react';

import { wrapEvalBundle } from '../bundler/wrap-eval-bundle';

const installExpoProductivityShim = require('../../../../../../../packages/mobile-preview/runtime/shims/expo/productivity.js');

const {
    CALENDAR_MODULE_ID,
    CONTACTS_MODULE_ID,
    RUNTIME_SHIM_REGISTRY_KEY,
} = installExpoProductivityShim;

type RuntimeGlobalState = {
    React?: typeof React;
    RawText?: string;
    TextC?:
        | string
        | ((props: { children?: React.ReactNode }) => React.ReactElement);
    View?: string;
    __onlookShims?: Record<string, unknown>;
    renderApp?: (element: unknown) => void;
};

function resolveRenderedElement(
    element: React.ReactElement,
): React.ReactElement<Record<string, unknown>> {
    if (typeof element.type !== 'function') {
        return element as React.ReactElement<Record<string, unknown>>;
    }

    return element.type(
        element.props,
    ) as React.ReactElement<Record<string, unknown>>;
}

function withRuntimeGlobals(
    run: (runtimeGlobal: RuntimeGlobalState) => Promise<void> | void,
) {
    const runtimeGlobal = globalThis as typeof globalThis & RuntimeGlobalState;
    const previousState = {
        React: runtimeGlobal.React,
        RawText: runtimeGlobal.RawText,
        TextC: runtimeGlobal.TextC,
        View: runtimeGlobal.View,
        renderApp: runtimeGlobal.renderApp,
        runtimeShims: runtimeGlobal.__onlookShims,
    };

    runtimeGlobal.React = React;
    runtimeGlobal.View = 'View';
    runtimeGlobal.RawText = 'RCTRawText';
    runtimeGlobal.TextC = 'Text';

    return Promise.resolve()
        .then(() => run(runtimeGlobal))
        .finally(() => {
            runtimeGlobal.React = previousState.React;
            runtimeGlobal.RawText = previousState.RawText;
            runtimeGlobal.TextC = previousState.TextC;
            runtimeGlobal.View = previousState.View;
            runtimeGlobal.renderApp = previousState.renderApp;

            if (previousState.runtimeShims === undefined) {
                delete runtimeGlobal.__onlookShims;
            } else {
                runtimeGlobal.__onlookShims = previousState.runtimeShims;
            }
        });
}

describe('expo productivity shim', () => {
    test('installs expo-contacts and expo-calendar into __onlookShims', async () => {
        const target = {};

        const installedModules = installExpoProductivityShim(target);
        const contactsModule = installedModules[CONTACTS_MODULE_ID] as {
            Fields: Record<string, string>;
            default?: unknown;
            __esModule?: boolean;
            getContactsAsync: () => Promise<{
                data: unknown[];
                hasNextPage: boolean;
                hasPreviousPage: boolean;
                total: number;
            }>;
            getPermissionsAsync: () => Promise<{
                status: string;
                granted: boolean;
                canAskAgain: boolean;
                expires: string;
            }>;
        };
        const calendarModule = installedModules[CALENDAR_MODULE_ID] as {
            EntityTypes: Record<string, string>;
            default?: unknown;
            __esModule?: boolean;
            getCalendarPermissionsAsync: () => Promise<{
                status: string;
                granted: boolean;
                canAskAgain: boolean;
                expires: string;
            }>;
            getCalendarsAsync: (entityType?: string) => Promise<
                Array<{ entityType: string; id: string }>
            >;
            useCalendarPermissions: () => [
                unknown,
                () => Promise<unknown>,
                () => Promise<unknown>,
            ];
        };

        expect(target[RUNTIME_SHIM_REGISTRY_KEY][CONTACTS_MODULE_ID]).toBe(
            contactsModule,
        );
        expect(target[RUNTIME_SHIM_REGISTRY_KEY][CALENDAR_MODULE_ID]).toBe(
            calendarModule,
        );
        expect(contactsModule.default).toBe(contactsModule);
        expect(calendarModule.default).toBe(calendarModule);
        expect(contactsModule.__esModule).toBe(true);
        expect(calendarModule.__esModule).toBe(true);
        expect(contactsModule.Fields.Emails).toBe('emails');
        expect(calendarModule.EntityTypes.EVENT).toBe('event');

        await expect(contactsModule.getPermissionsAsync()).resolves.toEqual({
            status: 'granted',
            granted: true,
            canAskAgain: true,
            expires: 'never',
        });
        await expect(contactsModule.getContactsAsync()).resolves.toEqual({
            data: [],
            hasNextPage: false,
            hasPreviousPage: false,
            total: 0,
        });
        await expect(
            calendarModule.getCalendarPermissionsAsync(),
        ).resolves.toEqual({
            status: 'granted',
            granted: true,
            canAskAgain: true,
            expires: 'never',
        });
        await expect(
            calendarModule.getCalendarsAsync(calendarModule.EntityTypes.EVENT),
        ).resolves.toEqual([
            expect.objectContaining({
                entityType: 'event',
                id: 'preview-calendar',
            }),
        ]);

        const [calendarPermission, requestCalendarPermission] =
            calendarModule.useCalendarPermissions();

        expect(calendarPermission).toEqual({
            status: 'granted',
            granted: true,
            canAskAgain: true,
            expires: 'never',
        });
        await expect(requestCalendarPermission()).resolves.toEqual({
            status: 'granted',
            granted: true,
            canAskAgain: true,
            expires: 'never',
        });
    });

    test('merges productivity exports into existing expo registry entries', () => {
        const existingContactsToken = Symbol('contacts');
        const existingCalendarToken = Symbol('calendar');
        const target = {
            __onlookShims: {
                'expo-contacts': {
                    ExistingContactsToken: existingContactsToken,
                },
                'expo-calendar': {
                    ExistingCalendarToken: existingCalendarToken,
                },
            },
        };

        const installedModules = installExpoProductivityShim(target);
        const contactsModule = installedModules[CONTACTS_MODULE_ID] as {
            ExistingContactsToken: symbol;
            Fields: Record<string, string>;
            default?: unknown;
            __esModule?: boolean;
        };
        const calendarModule = installedModules[CALENDAR_MODULE_ID] as {
            EntityTypes: Record<string, string>;
            ExistingCalendarToken: symbol;
            default?: unknown;
            __esModule?: boolean;
        };

        expect(contactsModule).toBe(target.__onlookShims[CONTACTS_MODULE_ID]);
        expect(calendarModule).toBe(target.__onlookShims[CALENDAR_MODULE_ID]);
        expect(contactsModule.ExistingContactsToken).toBe(existingContactsToken);
        expect(calendarModule.ExistingCalendarToken).toBe(existingCalendarToken);
        expect(contactsModule.Fields.PhoneNumbers).toBe('phoneNumbers');
        expect(calendarModule.EntityTypes.REMINDER).toBe('reminder');
        expect(contactsModule.default).toBe(contactsModule);
        expect(calendarModule.default).toBe(calendarModule);
        expect(contactsModule.__esModule).toBe(true);
        expect(calendarModule.__esModule).toBe(true);
    });
});

describe('wrapEvalBundle runtime shim resolution', () => {
    test('loads expo-contacts and expo-calendar from __onlookShims', async () => {
        await withRuntimeGlobals((runtimeGlobal) => {
            const renderAppCalls: unknown[] = [];
            const installedModules = installExpoProductivityShim(
                runtimeGlobal,
            ) as Record<string, Record<string, unknown>>;
            const contactsModule = installedModules[CONTACTS_MODULE_ID];
            const calendarModule = installedModules[CALENDAR_MODULE_ID];

            contactsModule.previewSentinel = 'contacts-registry';
            calendarModule.previewSentinel = 'calendar-registry';

            runtimeGlobal.renderApp = (element) => {
                renderAppCalls.push(element);
            };

            const code = wrapEvalBundle('App.js', ['App.js'], {
                'App.js': `
                    const React = require('react');
                    const { Text } = require('react-native');
                    const Contacts = require('expo-contacts');
                    const Calendar = require('expo-calendar');

                    module.exports = function App() {
                        return React.createElement(
                            Text,
                            { testID: 'productivity-registry' },
                            Contacts.previewSentinel + ':' + Calendar.previewSentinel
                        );
                    };
                `,
            });

            (0, eval)(code);

            expect(renderAppCalls).toHaveLength(1);

            const appElement = resolveRenderedElement(
                renderAppCalls[0] as React.ReactElement,
            );
            const rendered = resolveRenderedElement(appElement);

            expect(rendered.type).toBe('Text');
            expect(rendered.props.testID).toBe('productivity-registry');
            expect(rendered.props.children).toBe(
                'contacts-registry:calendar-registry',
            );
        });
    });
});

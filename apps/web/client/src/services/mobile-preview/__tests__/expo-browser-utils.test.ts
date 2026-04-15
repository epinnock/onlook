import { describe, expect, test } from 'bun:test';
import React from 'react';

import { wrapEvalBundle } from '../bundler/wrap-eval-bundle';

const browserUtilsShim = require('../../../../../../../packages/mobile-preview/runtime/shims/expo/browser-utils.js') as {
    MODULE_IDS: {
        clipboard: string;
        haptics: string;
        webBrowser: string;
    };
    RUNTIME_SHIM_REGISTRY_KEY: string;
    install: (target: RuntimeGlobalState) => Record<string, BrowserUtilsModule>;
};

const { MODULE_IDS, RUNTIME_SHIM_REGISTRY_KEY } = browserUtilsShim;

type BrowserUtilsModule = Record<string, unknown>;

type RuntimeGlobalState = {
    NativeModules?: Record<string, unknown>;
    React?: typeof React;
    RawText?: string;
    TextC?:
        | string
        | ((props: { children?: React.ReactNode }) => React.ReactElement);
    View?: string;
    __onlookShims?: Record<string, unknown>;
    __turboModuleProxy?:
        | ((name: string) => unknown)
        | Record<string, unknown>;
    nativeModuleProxy?: Record<string, unknown>;
    renderApp?: (element: unknown) => void;
};

function withRuntimeGlobals(
    run: (runtimeGlobal: RuntimeGlobalState) => Promise<void> | void,
) {
    const runtimeGlobal = globalThis as typeof globalThis & RuntimeGlobalState;
    const previousState = {
        React: runtimeGlobal.React,
        RawText: runtimeGlobal.RawText,
        TextC: runtimeGlobal.TextC,
        View: runtimeGlobal.View,
        nativeModuleProxy: runtimeGlobal.nativeModuleProxy,
        renderApp: runtimeGlobal.renderApp,
        runtimeShims: runtimeGlobal.__onlookShims,
        turboModuleProxy: runtimeGlobal.__turboModuleProxy,
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
            runtimeGlobal.nativeModuleProxy = previousState.nativeModuleProxy;
            runtimeGlobal.renderApp = previousState.renderApp;
            runtimeGlobal.__turboModuleProxy = previousState.turboModuleProxy;

            if (previousState.runtimeShims === undefined) {
                delete runtimeGlobal.__onlookShims;
            } else {
                runtimeGlobal.__onlookShims = previousState.runtimeShims;
            }
        });
}

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

describe('expo browser utils shim', () => {
    test('installs expo-web-browser, expo-clipboard, and expo-haptics into __onlookShims', async () => {
        const target: RuntimeGlobalState = {};

        const installedModules = browserUtilsShim.install(target);
        const clipboardModule = installedModules[MODULE_IDS.clipboard] as {
            ClipboardPasteButton: () => null;
            ContentType: { PLAIN_TEXT: string };
            getString: () => string;
            getStringAsync: () => Promise<string>;
            hasStringAsync: () => Promise<boolean>;
            setString: (value: string) => boolean;
            setStringAsync: (value: string) => Promise<boolean>;
        };
        const hapticsModule = installedModules[MODULE_IDS.haptics] as {
            ImpactFeedbackStyle: { Medium: string };
            selectionAsync: () => Promise<void>;
        };
        const webBrowserModule = installedModules[MODULE_IDS.webBrowser] as {
            maybeCompleteAuthSession: () => { message: string; type: string };
            openAuthSessionAsync: (
                url: string,
                redirectUrl?: string,
            ) => Promise<{ type: string }>;
            openBrowserAsync: (url: string) => Promise<{ type: string }>;
        };

        expect(target[RUNTIME_SHIM_REGISTRY_KEY]?.[MODULE_IDS.clipboard]).toBe(
            clipboardModule,
        );
        expect(target[RUNTIME_SHIM_REGISTRY_KEY]?.[MODULE_IDS.haptics]).toBe(
            hapticsModule,
        );
        expect(target[RUNTIME_SHIM_REGISTRY_KEY]?.[MODULE_IDS.webBrowser]).toBe(
            webBrowserModule,
        );

        expect(await clipboardModule.setStringAsync('copied')).toBe(true);
        expect(await clipboardModule.getStringAsync()).toBe('copied');
        expect(clipboardModule.getString()).toBe('copied');
        expect(await clipboardModule.hasStringAsync()).toBe(true);
        expect(clipboardModule.ContentType.PLAIN_TEXT).toBe('plain-text');
        expect(clipboardModule.ClipboardPasteButton()).toBeNull();

        expect(await hapticsModule.selectionAsync()).toBeUndefined();
        expect(hapticsModule.ImpactFeedbackStyle.Medium).toBe('Medium');

        expect(
            await webBrowserModule.openBrowserAsync('https://example.com'),
        ).toEqual({ type: 'opened' });
        expect(
            await webBrowserModule.openAuthSessionAsync(
                'https://example.com/login',
                'my-app://callback',
            ),
        ).toEqual({ type: 'cancel' });
        expect(webBrowserModule.maybeCompleteAuthSession()).toEqual({
            message: 'Auth session completion is not available in mobile preview.',
            type: 'failed',
        });
    });

    test('proxies to native browser utility modules when they are available', async () => {
        const target: RuntimeGlobalState = {
            nativeModuleProxy: {
                ExpoClipboard: {
                    getStringAsync() {
                        return 'native-copy';
                    },
                    setStringAsync(value: string) {
                        return value === 'native-copy';
                    },
                },
                ExpoHaptics: {
                    selectionAsync() {
                        return 'native-selection';
                    },
                },
                ExpoWebBrowser: {
                    openBrowserAsync(url: string) {
                        return { type: 'native-open', url };
                    },
                },
            },
        };

        const installedModules = browserUtilsShim.install(target);
        const clipboardModule = installedModules[MODULE_IDS.clipboard] as {
            getStringAsync: () => Promise<string>;
            setStringAsync: (value: string) => Promise<boolean>;
        };
        const hapticsModule = installedModules[MODULE_IDS.haptics] as {
            selectionAsync: () => Promise<string>;
        };
        const webBrowserModule = installedModules[MODULE_IDS.webBrowser] as {
            openBrowserAsync: (
                url: string,
            ) => Promise<{ type: string; url: string }>;
        };

        expect(await clipboardModule.getStringAsync()).toBe('native-copy');
        expect(await clipboardModule.setStringAsync('native-copy')).toBe(true);
        expect(await hapticsModule.selectionAsync()).toBe('native-selection');
        expect(
            await webBrowserModule.openBrowserAsync('https://native.example'),
        ).toEqual({
            type: 'native-open',
            url: 'https://native.example',
        });
    });

    test('merges into existing expo browser utility registry entries', async () => {
        const existingClipboardModule = {
            getStringAsync() {
                return Promise.resolve('existing-copy');
            },
        };
        const existingHapticsModule = {
            impactAsync() {
                return Promise.resolve('existing-impact');
            },
        };
        const existingWebBrowserModule = {
            openBrowserAsync() {
                return Promise.resolve({ type: 'existing-open' });
            },
        };
        const target: RuntimeGlobalState = {
            __onlookShims: {
                [MODULE_IDS.clipboard]: existingClipboardModule,
                [MODULE_IDS.haptics]: existingHapticsModule,
                [MODULE_IDS.webBrowser]: existingWebBrowserModule,
            },
        };

        const installedModules = browserUtilsShim.install(target);
        const clipboardModule = installedModules[MODULE_IDS.clipboard] as {
            default?: unknown;
            getStringAsync: () => Promise<string>;
            hasStringAsync: () => Promise<boolean>;
        };
        const hapticsModule = installedModules[MODULE_IDS.haptics] as {
            ImpactFeedbackStyle: { Heavy: string };
            impactAsync: () => Promise<string>;
        };
        const webBrowserModule = installedModules[MODULE_IDS.webBrowser] as {
            WebBrowserResultType: { OPENED: string };
            default?: unknown;
            openBrowserAsync: () => Promise<{ type: string }>;
        };

        expect(clipboardModule).toBe(existingClipboardModule);
        expect(hapticsModule).toBe(existingHapticsModule);
        expect(webBrowserModule).toBe(existingWebBrowserModule);

        expect(await clipboardModule.getStringAsync()).toBe('existing-copy');
        expect(await clipboardModule.hasStringAsync()).toBe(false);
        expect(clipboardModule.default).toBe(existingClipboardModule);

        expect(await hapticsModule.impactAsync()).toBe('existing-impact');
        expect(hapticsModule.ImpactFeedbackStyle.Heavy).toBe('Heavy');

        expect(await webBrowserModule.openBrowserAsync()).toEqual({
            type: 'existing-open',
        });
        expect(webBrowserModule.WebBrowserResultType.OPENED).toBe('opened');
        expect(webBrowserModule.default).toBe(existingWebBrowserModule);
    });
});

describe('wrapEvalBundle expo browser utils resolution', () => {
    test('loads expo browser utility modules from __onlookShims', async () => {
        await withRuntimeGlobals((runtimeGlobal) => {
            const renderAppCalls: unknown[] = [];
            runtimeGlobal.renderApp = (element) => {
                renderAppCalls.push(element);
            };

            const installedModules = browserUtilsShim.install(runtimeGlobal);
            const clipboardModule = installedModules[MODULE_IDS.clipboard] as {
                getString: () => string;
            };
            const hapticsModule = installedModules[MODULE_IDS.haptics] as {
                tag?: string;
            };
            const webBrowserModule = installedModules[MODULE_IDS.webBrowser] as {
                maybeCompleteAuthSession: () => { type: string };
            };

            clipboardModule.getString = () => 'from-registry';
            hapticsModule.tag = 'registry-haptics';
            webBrowserModule.maybeCompleteAuthSession = () => ({
                type: 'registry-browser',
            });

            const code = wrapEvalBundle('App.js', ['App.js'], {
                'App.js': `
                    const React = require('react');
                    const { View } = require('react-native');
                    const Clipboard = require('expo-clipboard');
                    const Haptics = require('expo-haptics');
                    const WebBrowser = require('expo-web-browser');

                    module.exports = function App() {
                        return React.createElement(
                            View,
                            {
                                browser: WebBrowser.maybeCompleteAuthSession().type,
                                clipboard: Clipboard.getString(),
                                haptics: Haptics.tag,
                            },
                            'browser-utils'
                        );
                    };
                `,
            });

            (0, eval)(code);

            expect(renderAppCalls).toHaveLength(1);

            const rendered = resolveRenderedElement(
                renderAppCalls[0] as React.ReactElement,
            );

            expect(rendered.type).toBe('View');
            expect(rendered.props.clipboard).toBe('from-registry');
            expect(rendered.props.haptics).toBe('registry-haptics');
            expect(rendered.props.browser).toBe('registry-browser');
            expect(rendered.props.children).toBe('browser-utils');
        });
    });
});

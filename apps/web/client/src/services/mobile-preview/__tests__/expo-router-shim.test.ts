import { describe, expect, test } from 'bun:test';
import React from 'react';

import { wrapEvalBundle } from '../bundler/wrap-eval-bundle';

const installExpoRouterShim = require('../../../../../../../packages/mobile-preview/runtime/shims/expo/expo-router.js');
const installOnlookPreloadScriptShim = require('../../../../../../../packages/mobile-preview/runtime/shims/core/onlook-preload-script.js');

const {
    MODULE_ID: EXPO_ROUTER_MODULE_ID,
    RUNTIME_SHIM_REGISTRY_KEY,
} = installExpoRouterShim;
const { MODULE_ID: PRELOAD_SCRIPT_MODULE_ID } = installOnlookPreloadScriptShim;

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

function createTarget() {
    return {
        React,
        TextC: 'Text',
    };
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

describe('expo-router shim', () => {
    test('installs the module into __onlookShims', () => {
        const target = createTarget();

        const moduleExports = installExpoRouterShim(target);

        expect(target[RUNTIME_SHIM_REGISTRY_KEY][EXPO_ROUTER_MODULE_ID]).toBe(
            moduleExports,
        );
        expect(moduleExports.default).toBe(moduleExports);
        expect(moduleExports.__esModule).toBe(true);

        const link = moduleExports.Link({
            accessibilityLabel: 'Open details',
            children: 'Details',
            style: { fontSize: 16 },
            testID: 'expo-link',
        });

        expect(link.type).toBe('Text');
        expect(link.props.children).toBe('Details');
        expect(link.props.style).toEqual({ fontSize: 16 });
        expect(link.props.testID).toBe('expo-link');
        expect(link.props.accessibilityLabel).toBe('Open details');
        expect(moduleExports.Redirect()).toBeNull();

        const stack = moduleExports.Stack({ children: 'StackChild' });
        const slot = moduleExports.Slot({ children: 'SlotChild' });
        const tabs = moduleExports.Tabs({ children: 'TabsChild' });

        expect(stack.type).toBe(React.Fragment);
        expect(stack.props.children).toBe('StackChild');
        expect(slot.type).toBe(React.Fragment);
        expect(slot.props.children).toBe('SlotChild');
        expect(tabs.type).toBe(React.Fragment);
        expect(tabs.props.children).toBe('TabsChild');

        const router = moduleExports.useRouter();

        expect(router).toEqual({
            back: expect.any(Function),
            push: expect.any(Function),
            replace: expect.any(Function),
        });
        expect(moduleExports.useLocalSearchParams()).toEqual({});
    });
});

describe('onlook-preload-script shim', () => {
    test('registers a stable no-op module into __onlookShims', () => {
        const target: RuntimeGlobalState = {};

        const moduleExports = installOnlookPreloadScriptShim(target);
        const repeatInstall = installOnlookPreloadScriptShim(target);

        expect(
            target[RUNTIME_SHIM_REGISTRY_KEY]?.[PRELOAD_SCRIPT_MODULE_ID],
        ).toBe(moduleExports);
        expect(moduleExports).toEqual({});
        expect(repeatInstall).toBe(moduleExports);
    });
});

describe('wrapEvalBundle runtime shim resolution', () => {
    test('loads expo-router and onlook-preload-script from __onlookShims', async () => {
        await withRuntimeGlobals((runtimeGlobal) => {
            const renderAppCalls: unknown[] = [];
            const routerCalls: string[] = [];

            installOnlookPreloadScriptShim(runtimeGlobal);
            const moduleExports = installExpoRouterShim(runtimeGlobal);
            const runtimeShimRegistry = runtimeGlobal.__onlookShims ?? {};

            const registryExpoRouterModule: {
                Link: (props: { children?: React.ReactNode }) => React.ReactElement;
                useLocalSearchParams: () => { label: string };
                useRouter: () => {
                    push: (path: string) => void;
                    replace: () => void;
                    back: () => void;
                };
                default?: unknown;
                __esModule?: boolean;
            } & typeof moduleExports = {
                ...moduleExports,
                Link(props: { children?: React.ReactNode }) {
                    return React.createElement(
                        'RegistryLink',
                        { source: 'registry' },
                        props.children,
                    );
                },
                useRouter() {
                    return {
                        push(path: string) {
                            routerCalls.push(`push:${path}`);
                        },
                        replace() {},
                        back() {},
                    };
                },
                useLocalSearchParams() {
                    return { label: 'from-registry' };
                },
            };

            registryExpoRouterModule.default = registryExpoRouterModule;
            registryExpoRouterModule.__esModule = true;
            runtimeShimRegistry[EXPO_ROUTER_MODULE_ID] =
                registryExpoRouterModule;
            runtimeGlobal.__onlookShims = runtimeShimRegistry;
            runtimeGlobal.renderApp = (element) => {
                renderAppCalls.push(element);
            };

            const code = wrapEvalBundle('App.js', ['App.js'], {
                'App.js': `
                    const React = require('react');
                    require('onlook-preload-script.js');
                    const { Link, useLocalSearchParams, useRouter } = require('expo-router');

                    module.exports = function App() {
                        const router = useRouter();
                        const params = useLocalSearchParams();
                        router.push('/settings');
                        return React.createElement(Link, null, params.label);
                    };
                `,
            });

            expect(code).not.toContain("specifier === 'expo-router'");
            expect(code).not.toContain(
                "specifier === 'onlook-preload-script.js'",
            );

            (0, eval)(code);

            expect(renderAppCalls).toHaveLength(1);

            const appElement = resolveRenderedElement(
                renderAppCalls[0] as React.ReactElement,
            );
            const rendered = resolveRenderedElement(appElement);

            expect(routerCalls).toEqual(['push:/settings']);
            expect(rendered.type).toBe('RegistryLink');
            expect(rendered.props.source).toBe('registry');
            expect(rendered.props.children).toBe('from-registry');
        });
    });
});

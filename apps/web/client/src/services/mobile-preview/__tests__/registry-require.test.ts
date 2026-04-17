import { describe, expect, test } from 'bun:test';
import React from 'react';

import { wrapEvalBundle } from '../bundler/wrap-eval-bundle';

const reactNativeShim = require('../../../../../../../packages/mobile-preview/runtime/shims/core/react-native.js');

const {
    MODULE_ID: REACT_NATIVE_MODULE_ID,
    RUNTIME_SHIM_REGISTRY_KEY,
} = reactNativeShim;

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

    const functionComponent = element.type as (
        props: unknown,
    ) => React.ReactElement<Record<string, unknown>>;
    return functionComponent(element.props);
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

describe('wrapEvalBundle registry-backed require', () => {
    test('loads react-native from __onlookShims before the inline fallback', async () => {
        await withRuntimeGlobals((runtimeGlobal) => {
            const renderAppCalls: unknown[] = [];
            runtimeGlobal.renderApp = (element) => {
                renderAppCalls.push(element);
            };

            const registryReactNativeModule = reactNativeShim.install(
                runtimeGlobal,
            ) as {
                View: string;
                default?: unknown;
                __esModule?: boolean;
            };
            registryReactNativeModule.View = 'RegistryView';
            registryReactNativeModule.default = registryReactNativeModule;
            registryReactNativeModule.__esModule = true;

            const code = wrapEvalBundle('App.js', ['App.js'], {
                'App.js': `
                    const React = require('react');
                    const { View } = require('react-native');

                    module.exports = function App() {
                        return React.createElement(View, { testID: 'registry-view' }, 'from-registry');
                    };
                `,
            });

            (0, eval)(code);

            expect(renderAppCalls).toHaveLength(1);
            expect(
                runtimeGlobal.__onlookShims?.[REACT_NATIVE_MODULE_ID],
            ).toBe(registryReactNativeModule);

            const rendered = resolveRenderedElement(
                renderAppCalls[0] as React.ReactElement,
            );

            expect(rendered.type).toBe('RegistryView');
            expect(rendered.props.testID).toBe('registry-view');
            expect(rendered.props.children).toBe('from-registry');
        });
    });

    test('falls back to the inline react-native runtime when the registry has no entry', async () => {
        await withRuntimeGlobals((runtimeGlobal) => {
            const renderAppCalls: unknown[] = [];
            runtimeGlobal.renderApp = (element) => {
                renderAppCalls.push(element);
            };
            runtimeGlobal.__onlookShims = {};

            const code = wrapEvalBundle('App.js', ['App.js'], {
                'App.js': `
                    const React = require('react');
                    const { View } = require('react-native');

                    module.exports = function App() {
                        return React.createElement(View, { testID: 'inline-view' }, 'from-inline');
                    };
                `,
            });

            (0, eval)(code);

            expect(renderAppCalls).toHaveLength(1);

            const rendered = resolveRenderedElement(
                renderAppCalls[0] as React.ReactElement,
            );

            expect(rendered.type).toBe('View');
            expect(rendered.props.testID).toBe('inline-view');
            expect(rendered.props.children).toBe('from-inline');
        });
    });
});

import { describe, expect, test } from 'bun:test';
import React from 'react';

const reactNativeShim = require('../../../../../../../packages/mobile-preview/runtime/shims/core/react-native.js') as {
    MODULE_ID: string;
    RUNTIME_SHIM_REGISTRY_KEY: string;
    install: (target: RuntimeTarget) => ReactNativeModule;
};

const styleShim = require('../../../../../../../packages/mobile-preview/runtime/shims/core/style.js') as {
    STYLE_HELPERS_GLOBAL_KEY: string;
};

const { MODULE_ID, RUNTIME_SHIM_REGISTRY_KEY } = reactNativeShim;
const { STYLE_HELPERS_GLOBAL_KEY } = styleShim;

type StyleHelpers = {
    composeStyles: (a: unknown, b: unknown) => unknown;
    createStyleSheet: (styles: Record<string, unknown>) => unknown;
    flattenStyle: (style: unknown) => unknown;
};

type RuntimeTarget = Record<string, unknown> & {
    React?: typeof React;
    RawText?: string;
    Text?: string;
    TextC?: (props: { children?: React.ReactNode; testID?: string }) => React.ReactElement;
    View?: string;
    renderApp?: (element: unknown) => void;
};

type ReactNativeModule = Record<string, unknown> & {
    __esModule: boolean;
    default: unknown;
    Alert: {
        alert: () => void;
    };
    AppRegistry: {
        registerComponent: (appKey: string, componentProvider: () => React.ComponentType) => void;
        runApplication: () => void;
    };
    Dimensions: {
        get: () => {
            width: number;
            height: number;
            scale: number;
            fontScale: number;
        };
    };
    Fragment: typeof React.Fragment;
    Platform: {
        OS: string;
        select: (options: Record<string, unknown>) => unknown;
    };
    Pressable: (props: Record<string, unknown>) => React.ReactElement;
    RawText: string;
    StatusBar: () => null;
    StyleSheet: {
        compose: (a: unknown, b: unknown) => unknown;
        create: (styles: Record<string, unknown>) => unknown;
        flatten: (style: unknown) => unknown;
    };
    Text: (props: { children?: React.ReactNode; testID?: string }) => React.ReactElement;
    TouchableOpacity: (props: Record<string, unknown>) => React.ReactElement;
    View: string;
};

function createTarget(overrides: Partial<RuntimeTarget> = {}): RuntimeTarget {
    return {
        React,
        View: 'View',
        Text: 'RCTText',
        RawText: 'RCTRawText',
        TextC: ({ children, ...rest }) =>
            React.createElement('RCTText', rest, children),
        ...overrides,
    };
}

describe('react-native shim', () => {
    test('installs the module into __onlookShims and merges an existing registry entry', () => {
        const existingAnimated = { spring() {} };
        const target = createTarget({
            [RUNTIME_SHIM_REGISTRY_KEY]: {
                [MODULE_ID]: {
                    Animated: existingAnimated,
                },
            },
        });

        const moduleExports = reactNativeShim.install(target);
        const registry = target[RUNTIME_SHIM_REGISTRY_KEY] as Record<string, unknown>;

        expect(registry[MODULE_ID]).toBe(moduleExports);
        expect(moduleExports.default).toBe(moduleExports);
        expect(moduleExports.__esModule).toBe(true);
        expect(moduleExports.Animated).toBe(existingAnimated);
        expect(moduleExports.View).toBe('View');
        expect(moduleExports.RawText).toBe('RCTRawText');
        expect(moduleExports.Fragment).toBe(React.Fragment);
    });

    test('delegates StyleSheet helpers to the shared style helper registry', () => {
        const sharedHelpers: StyleHelpers = {
            composeStyles: (a, b) => ({ marker: 'compose', left: a, right: b }),
            createStyleSheet: (styles) => ({ marker: 'create', styles }),
            flattenStyle: (style) => ({ marker: 'flatten', style }),
        };
        const target = createTarget({
            [STYLE_HELPERS_GLOBAL_KEY]: sharedHelpers,
        });

        const moduleExports = reactNativeShim.install(target);

        expect(target[STYLE_HELPERS_GLOBAL_KEY]).toBe(sharedHelpers);
        expect(moduleExports.StyleSheet.create({ root: { padding: 4 } })).toEqual({
            marker: 'create',
            styles: { root: { padding: 4 } },
        });
        expect(
            moduleExports.StyleSheet.compose({ flex: 1 }, { padding: 8 }),
        ).toEqual({
            marker: 'compose',
            left: { flex: 1 },
            right: { padding: 8 },
        });
        expect(moduleExports.StyleSheet.flatten([{ color: '#fff' }])).toEqual({
            marker: 'flatten',
            style: [{ color: '#fff' }],
        });
    });

    test('renders touchables through the preview View host and strips press props', () => {
        const target = createTarget();
        const moduleExports = reactNativeShim.install(target);
        const child = React.createElement('Child', { id: 'child' });

        const element = moduleExports.TouchableOpacity({
            style: { flex: 1 },
            testID: 'touchable',
            onPress() {},
            onPressIn() {},
            onPressOut() {},
            onLongPress() {},
            activeOpacity: 0.2,
            underlayColor: '#fff',
            children: child,
        });

        expect(element.type).toBe('View');
        const touchableProps = element.props as {
            children: unknown;
            style: unknown;
            testID: unknown;
        };
        expect(touchableProps.children).toBe(child);
        expect(touchableProps.style).toEqual({ flex: 1 });
        expect(touchableProps.testID).toBe('touchable');
        expect(element.props).not.toHaveProperty('onPress');
        expect(element.props).not.toHaveProperty('activeOpacity');
        expect(moduleExports.Platform.OS).toBe('ios');
        expect(
            moduleExports.Platform.select({
                android: 'android',
                ios: 'ios',
                native: 'native',
                default: 'default',
            }),
        ).toBe('ios');
        expect(moduleExports.Dimensions.get()).toEqual({
            width: 390,
            height: 844,
            scale: 3,
            fontScale: 1,
        });
        expect(moduleExports.StatusBar()).toBeNull();
    });

    test('falls back to an inline text wrapper when TextC is unavailable', () => {
        const target = createTarget({ TextC: undefined });
        const moduleExports = reactNativeShim.install(target);
        const child = React.createElement('Child', { id: 'child' });

        const element = moduleExports.Text({
            testID: 'label',
            children: ['hello', child],
        });

        expect(element.type).toBe('RCTText');
        const textProps = element.props as {
            testID: unknown;
            children: unknown;
        };
        expect(textProps.testID).toBe('label');
        expect(textProps.children).toEqual([
            React.createElement('RCTRawText', { key: 0, text: 'hello' }),
            child,
        ]);
    });

    test('AppRegistry renders the main component once', () => {
        const renderAppCalls: unknown[] = [];
        const target = createTarget({
            renderApp(element) {
                renderAppCalls.push(element);
            },
        });
        const moduleExports = reactNativeShim.install(target);

        function App() {
            return React.createElement('View', { testID: 'app-root' });
        }

        moduleExports.AppRegistry.registerComponent('secondary', () => App);
        moduleExports.AppRegistry.registerComponent('main', () => App);
        moduleExports.AppRegistry.registerComponent('main', () => () => null);

        expect(renderAppCalls).toHaveLength(1);
        expect((renderAppCalls[0] as React.ReactElement).type).toBe(App);
        expect(typeof moduleExports.Alert.alert).toBe('function');
    });
});

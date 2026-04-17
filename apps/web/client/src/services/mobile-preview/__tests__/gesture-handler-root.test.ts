import { describe, expect, test } from 'bun:test';
import React from 'react';

const installReactNativeGestureHandlerRoot = require('../../../../../../../packages/mobile-preview/runtime/shims/third-party/react-native-gesture-handler-root.js');

const { MODULE_ID, RUNTIME_SHIM_REGISTRY_KEY } =
    installReactNativeGestureHandlerRoot as {
        MODULE_ID: string;
        RUNTIME_SHIM_REGISTRY_KEY: string;
    };

type ShimTarget = {
    React: typeof React;
    View: string;
} & Record<string, Record<string, unknown>>;

function createTarget(): ShimTarget {
    return {
        React,
        View: 'View',
    } as ShimTarget;
}

describe('react-native-gesture-handler root shim', () => {
    test('installs root view exports into __onlookShims', () => {
        const target = createTarget();

        const moduleExports = installReactNativeGestureHandlerRoot(target);

        expect(target[RUNTIME_SHIM_REGISTRY_KEY]?.[MODULE_ID]).toBe(moduleExports);
        expect(moduleExports.default).toBe(moduleExports);
        expect(moduleExports.__esModule).toBe(true);
        expect(Object.keys(moduleExports)).toEqual(
            expect.arrayContaining([
                'GestureHandlerRootView',
                'gestureHandlerRootHOC',
            ]),
        );
    });

    test('renders GestureHandlerRootView through the preview View host and strips root-only props', () => {
        const target = createTarget();
        const moduleExports = installReactNativeGestureHandlerRoot(target);
        const child = React.createElement('Child', { id: 'child' });

        const element = moduleExports.GestureHandlerRootView({
            accessibilityRole: 'summary',
            nativeID: 'root-view',
            pointerEvents: 'box-none',
            style: { flex: 1 },
            testID: 'gesture-root',
            unstable_forceActive: true,
            children: child,
        });

        expect(element.type).toBe('View');
        expect(element.props.children).toBe(child);
        expect(element.props.style).toEqual({ flex: 1 });
        expect(element.props.testID).toBe('gesture-root');
        expect(element.props.nativeID).toBe('root-view');
        expect(element.props.pointerEvents).toBe('box-none');
        expect(element.props.accessibilityRole).toBe('summary');
        expect(element.props).not.toHaveProperty('unstable_forceActive');
    });

    test('wraps components with gestureHandlerRootHOC and merges into an existing registry entry', () => {
        const existingToken = Symbol('Existing');
        const target = {
            ...createTarget(),
            __onlookShims: {
                'react-native-gesture-handler': {
                    Existing: existingToken,
                },
            } as Record<string, Record<string, unknown>>,
        };

        const moduleExports = installReactNativeGestureHandlerRoot(target);
        function ExampleScreen(props: { label: string }) {
            return React.createElement('Child', props);
        }

        const Wrapped = moduleExports.gestureHandlerRootHOC(ExampleScreen, {
            style: { flex: 1 },
            testID: 'hoc-root',
            unstable_forceActive: true,
        });
        const wrappedElement = Wrapped({ label: 'hello' });

        expect(moduleExports).toBe(target.__onlookShims[MODULE_ID]);
        expect(moduleExports.Existing).toBe(existingToken);
        expect(moduleExports.default).toBe(moduleExports);
        expect(moduleExports.__esModule).toBe(true);
        expect(wrappedElement.type.displayName).toBe('GestureHandlerRootView');
        expect(wrappedElement.props.testID).toBe('hoc-root');
        expect(wrappedElement.props.style).toEqual({ flex: 1 });
        expect(wrappedElement.props).not.toHaveProperty('unstable_forceActive');
        expect(wrappedElement.props.children.type).toBe(ExampleScreen);
        expect(wrappedElement.props.children.props.label).toBe('hello');
    });
});

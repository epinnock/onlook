import { describe, expect, test } from 'bun:test';
import React from 'react';

const installReactNativeScreens = require('../../../../../../../packages/mobile-preview/runtime/shims/third-party/react-native-screens.js');

const { MODULE_ID, RUNTIME_SHIM_REGISTRY_KEY } = installReactNativeScreens;

function createTarget() {
    return {
        React,
        View: 'View',
    };
}

describe('react-native-screens shim', () => {
    test('installs pass-through exports into __onlookShims', () => {
        const target = createTarget();

        const moduleExports = installReactNativeScreens(target);

        expect(target[RUNTIME_SHIM_REGISTRY_KEY][MODULE_ID]).toBe(moduleExports);
        expect(moduleExports.default).toBe(moduleExports);
        expect(moduleExports.__esModule).toBe(true);
        expect(Object.keys(moduleExports)).toEqual(
            expect.arrayContaining([
                'Screen',
                'NativeScreen',
                'ScreenContainer',
                'NativeScreenNavigationContainer',
                'ScreenStack',
                'ScreenStackHeaderConfig',
                'ScreenStackHeaderRightView',
                'SearchBar',
                'FullWindowOverlay',
                'enableScreens',
                'enableFreeze',
                'screensEnabled',
                'freezeEnabled',
                'useTransitionProgress',
            ]),
        );
        expect(moduleExports.shouldUseActivityState).toBe(true);
    });

    test('renders screen containers through the preview View host and strips screens-only props', () => {
        const target = createTarget();
        const moduleExports = installReactNativeScreens(target);
        const child = React.createElement('Child', { id: 'child' });

        const screen = moduleExports.Screen({
            style: { flex: 1 },
            activityState: 2,
            enabled: false,
            stackPresentation: 'modal',
            testID: 'screen',
            children: child,
        });

        expect(screen.type).toBe('View');
        expect(screen.props.children).toBe(child);
        expect(screen.props.style).toEqual({ flex: 1 });
        expect(screen.props.testID).toBe('screen');
        expect(screen.props).not.toHaveProperty('activityState');
        expect(screen.props).not.toHaveProperty('enabled');
        expect(screen.props).not.toHaveProperty('stackPresentation');

        const stack = moduleExports.ScreenStack({
            nativeID: 'stack',
            children: child,
        });

        expect(stack.type).toBe('View');
        expect(stack.props.nativeID).toBe('stack');
        expect(stack.props.children).toBe(child);
    });

    test('keeps header helpers and overlays lightweight', () => {
        const target = createTarget();
        const moduleExports = installReactNativeScreens(target);
        const child = React.createElement('Child', { id: 'child' });

        const rightView = moduleExports.ScreenStackHeaderRightView({
            children: child,
        });
        const header = moduleExports.ScreenStackHeaderConfig({
            hidden: true,
            children: rightView,
        });
        const overlay = moduleExports.FullWindowOverlay({
            children: child,
        });

        expect(rightView.type).toBe(React.Fragment);
        expect(rightView.props.children).toBe(child);
        expect(header.type).toBe(React.Fragment);
        expect(header.props.children).toBe(rightView);
        expect(overlay.type).toBe(React.Fragment);
        expect(overlay.props.children).toBe(child);
        expect(moduleExports.SearchBar({ placeholder: 'Search' })).toBeNull();
        expect(
            moduleExports.ScreenStackHeaderBackButtonImage({
                source: { uri: 'icon.png' },
            }),
        ).toBeNull();
    });

    test('tracks enable flags as preview-safe no-ops and merges into an existing registry entry', () => {
        const existingToken = Symbol('Existing');
        const target = {
            ...createTarget(),
            __onlookShims: {
                'react-native-screens': {
                    Existing: existingToken,
                },
            },
        };

        const moduleExports = installReactNativeScreens(target);

        expect(moduleExports).toBe(target.__onlookShims['react-native-screens']);
        expect(moduleExports.Existing).toBe(existingToken);
        expect(moduleExports.Screen).toBeDefined();
        expect(moduleExports.default).toBe(moduleExports);
        expect(moduleExports.__esModule).toBe(true);
        expect(moduleExports.screensEnabled()).toBe(true);
        expect(moduleExports.enableScreens(false)).toBe(false);
        expect(moduleExports.screensEnabled()).toBe(false);
        expect(moduleExports.enableFreeze(true)).toBe(true);
        expect(moduleExports.freezeEnabled()).toBe(true);
        expect(moduleExports.enableFreeze(false)).toBe(false);
        expect(moduleExports.freezeEnabled()).toBe(false);
        expect(moduleExports.useTransitionProgress()).toEqual({
            progress: 1,
            closing: 0,
            goingForward: 1,
        });
    });
});

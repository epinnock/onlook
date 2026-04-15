import { describe, expect, test } from 'bun:test';
import React from 'react';

const installSafeAreaShim = require('../../../../../../../packages/mobile-preview/runtime/shims/core/react-native-safe-area-context.js');

const { MODULE_ID, RUNTIME_SHIM_REGISTRY_KEY } = installSafeAreaShim;

function createTarget() {
    return {
        React,
        View: 'View',
    };
}

describe('react-native-safe-area-context shim', () => {
    test('installs the module into __onlookShims', () => {
        const target = createTarget();

        const moduleExports = installSafeAreaShim(target);

        expect(target[RUNTIME_SHIM_REGISTRY_KEY][MODULE_ID]).toBe(moduleExports);
        expect(moduleExports.default).toBe(moduleExports);
        expect(moduleExports.__esModule).toBe(true);
        expect(moduleExports.SafeAreaProvider).toBeDefined();
        expect(moduleExports.SafeAreaView).toBeDefined();
        expect(moduleExports.useSafeAreaInsets).toBeDefined();
    });

    test('SafeAreaProvider preserves children without adding wrapper nodes', () => {
        const target = createTarget();
        const moduleExports = installSafeAreaShim(target);
        const child = React.createElement('Child', { id: 'child' });

        const element = moduleExports.SafeAreaProvider({ children: child });

        expect(element.type).toBe(React.Fragment);
        expect(element.props.children).toBe(child);
    });

    test('SafeAreaView falls back to the preview View host and strips edges props', () => {
        const target = createTarget();
        const moduleExports = installSafeAreaShim(target);
        const child = React.createElement('Child', { id: 'child' });

        const element = moduleExports.SafeAreaView({
            style: { flex: 1 },
            edges: ['top', 'bottom'],
            testID: 'safe-area',
            children: child,
        });

        expect(element.type).toBe('View');
        expect(element.props.children).toBe(child);
        expect(element.props.style).toEqual({ flex: 1 });
        expect(element.props.testID).toBe('safe-area');
        expect(element.props).not.toHaveProperty('edges');
    });

    test('useSafeAreaInsets returns stable zero insets for preview rendering', () => {
        const target = createTarget();
        const moduleExports = installSafeAreaShim(target);

        expect(moduleExports.useSafeAreaInsets()).toEqual({
            top: 0,
            right: 0,
            bottom: 0,
            left: 0,
        });
        expect(moduleExports.useSafeAreaInsets()).toBe(moduleExports.useSafeAreaInsets());
    });
});

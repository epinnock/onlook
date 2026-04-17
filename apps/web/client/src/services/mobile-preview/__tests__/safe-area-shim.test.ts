import { describe, expect, test } from 'bun:test';
import React from 'react';

type SafeAreaShimModule = ((target: Record<string, unknown>) => {
    default: unknown;
    __esModule: boolean;
    SafeAreaProvider: (props: {
        children?: React.ReactNode;
    }) => React.ReactElement<Record<string, unknown>>;
    SafeAreaView: (
        props: Record<string, unknown>,
    ) => React.ReactElement<Record<string, unknown>>;
    useSafeAreaInsets: () => {
        top: number;
        right: number;
        bottom: number;
        left: number;
    };
}) & {
    MODULE_ID: string;
    RUNTIME_SHIM_REGISTRY_KEY: string;
};

const installSafeAreaShim = require('../../../../../../../packages/mobile-preview/runtime/shims/core/react-native-safe-area-context.js') as SafeAreaShimModule;

const { MODULE_ID, RUNTIME_SHIM_REGISTRY_KEY } = installSafeAreaShim;

function createTarget(): Record<string, unknown> {
    return {
        React,
        View: 'View',
    };
}

describe('react-native-safe-area-context shim', () => {
    test('installs the module into __onlookShims', () => {
        const target = createTarget();

        const moduleExports = installSafeAreaShim(target);

        const registry = target[RUNTIME_SHIM_REGISTRY_KEY] as Record<string, unknown>;
        expect(registry[MODULE_ID]).toBe(moduleExports);
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

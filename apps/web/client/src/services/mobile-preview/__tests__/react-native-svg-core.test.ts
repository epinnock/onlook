import { describe, expect, test } from 'bun:test';
import React from 'react';

const installReactNativeSvgCore = require('../../../../../../../packages/mobile-preview/runtime/shims/third-party/react-native-svg-core.js');

const { MODULE_ID, RUNTIME_SHIM_REGISTRY_KEY } = installReactNativeSvgCore as {
    MODULE_ID: string;
    RUNTIME_SHIM_REGISTRY_KEY: '__onlookShims';
};

type ShimTarget = {
    React: typeof React;
    View: string;
    __onlookShims?: Record<string, Record<string, unknown>>;
};

function createTarget(): ShimTarget {
    return {
        React,
        View: 'View',
    };
}

describe('react-native-svg core shim', () => {
    test('installs core exports into __onlookShims', () => {
        const target = createTarget();

        const moduleExports = installReactNativeSvgCore(target);

        expect(target[RUNTIME_SHIM_REGISTRY_KEY]?.[MODULE_ID]).toBe(moduleExports);
        expect(moduleExports.default).toBe(moduleExports.Svg);
        expect(moduleExports.__esModule).toBe(true);
        expect(Object.keys(moduleExports)).toEqual(
            expect.arrayContaining([
                'Svg',
                'G',
                'Defs',
                'ClipPath',
                'LinearGradient',
                'RadialGradient',
                'Mask',
                'Marker',
                'Pattern',
                'Symbol',
                'Use',
                'Stop',
            ]),
        );
    });

    test('renders Svg through the preview View host and folds dimensions into style', () => {
        const target = createTarget();
        const moduleExports = installReactNativeSvgCore(target);
        const child = React.createElement('Child', { id: 'child' });

        const element = moduleExports.Svg({
            width: 24,
            height: '100%',
            style: { marginTop: 8 },
            testID: 'logo',
            fill: '#111111',
            viewBox: '0 0 24 24',
            children: child,
        });

        expect(element.type).toBe('View');
        expect(element.props.children).toBe(child);
        expect(element.props.style).toEqual([{ marginTop: 8 }, { width: 24, height: '100%' }]);
        expect(element.props.testID).toBe('logo');
        expect(element.props).not.toHaveProperty('fill');
        expect(element.props).not.toHaveProperty('viewBox');
    });

    test('keeps structural primitives lightweight and stop as a leaf no-op', () => {
        const target = createTarget();
        const moduleExports = installReactNativeSvgCore(target);
        const child = React.createElement('Child', { id: 'child' });

        const group = moduleExports.G({
            fill: '#222222',
            stroke: '#ffffff',
            children: child,
        });

        expect(group.type).toBe(React.Fragment);
        expect(group.props.children).toBe(child);
        expect(moduleExports.Stop({ offset: '0%', stopColor: '#000000' })).toBeNull();
    });

    test('merges core exports into an existing react-native-svg registry entry', () => {
        const pathToken = Symbol('Path');
        const target = {
            ...createTarget(),
            __onlookShims: {
                'react-native-svg': {
                    Path: pathToken,
                },
            },
        };

        const moduleExports = installReactNativeSvgCore(target);

        expect(moduleExports).toBe(target.__onlookShims['react-native-svg']);
        expect(moduleExports.Path).toBe(pathToken);
        expect(moduleExports.Svg).toBeDefined();
        expect(moduleExports.default).toBe(moduleExports.Svg);
        expect(moduleExports.__esModule).toBe(true);
    });
});

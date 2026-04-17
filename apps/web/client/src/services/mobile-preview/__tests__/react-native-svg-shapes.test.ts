import { describe, expect, test } from 'bun:test';
import React from 'react';

const installReactNativeSvgShapes = require('../../../../../../../packages/mobile-preview/runtime/shims/third-party/react-native-svg-shapes.js');

const { MODULE_ID, RUNTIME_SHIM_REGISTRY_KEY } = installReactNativeSvgShapes;

function createTarget() {
    return {
        React,
        View: 'View',
    };
}

describe('react-native-svg shapes shim', () => {
    test('installs shape exports into the react-native-svg runtime registry entry', () => {
        const target = createTarget();

        const moduleExports = installReactNativeSvgShapes(target);

        expect(target[RUNTIME_SHIM_REGISTRY_KEY][MODULE_ID]).toBe(moduleExports);
        expect(moduleExports.default).toBe(moduleExports.Svg);
        expect(moduleExports.__esModule).toBe(true);
        expect(Object.keys(moduleExports)).toEqual(
            expect.arrayContaining([
                'Svg',
                'Circle',
                'Ellipse',
                'Line',
                'Path',
                'Polygon',
                'Polyline',
                'Rect',
            ]),
        );
    });

    test('renders Rect through the preview View host and folds fill and stroke into style', () => {
        const moduleExports = installReactNativeSvgShapes(createTarget());

        const element = moduleExports.Rect({
            width: 32,
            height: 16,
            fill: '#123456',
            stroke: '#abcdef',
            strokeWidth: 2,
            rx: 4,
            style: { marginTop: 8 },
            testID: 'shape-rect',
        });

        expect(element.type).toBe('View');
        expect(element.props.style).toEqual([
            { marginTop: 8 },
            {
                width: 32,
                height: 16,
                borderRadius: 4,
                backgroundColor: '#123456',
                borderColor: '#abcdef',
                borderWidth: 2,
            },
        ]);
        expect(element.props.testID).toBe('shape-rect');
    });

    test('renders Circle with derived diameter and border radius', () => {
        const moduleExports = installReactNativeSvgShapes(createTarget());

        const element = moduleExports.Circle({
            r: 12,
            fill: '#ff0000',
            opacity: 0.4,
        });

        expect(element.type).toBe('View');
        expect(element.props.style).toEqual({
            width: 24,
            height: 24,
            borderRadius: 12,
            backgroundColor: '#ff0000',
            opacity: 0.4,
        });
    });

    test('keeps path-like primitives lightweight while remaining visible to the host', () => {
        const moduleExports = installReactNativeSvgShapes(createTarget());

        const element = moduleExports.Path({
            d: 'M0 0L10 10',
            stroke: '#111111',
            strokeWidth: 3,
            accessibilityLabel: 'triangle',
        });

        expect(element.type).toBe('View');
        expect(element.props.style).toEqual({
            width: 3,
            height: 3,
            backgroundColor: '#111111',
        });
        expect(element.props.accessibilityLabel).toBe('triangle');
    });

    test('merges shapes into an existing react-native-svg registry entry', () => {
        const pathToken = Symbol('Path');
        const target = {
            ...createTarget(),
            __onlookShims: {
                'react-native-svg': {
                    Path: pathToken,
                },
            },
        };

        const moduleExports = installReactNativeSvgShapes(target);

        expect(moduleExports).toBe(target.__onlookShims['react-native-svg']);
        expect(moduleExports.Path).toBe(pathToken);
        expect(moduleExports.Rect).toBeDefined();
        expect(moduleExports.Svg).toBeDefined();
        expect(moduleExports.default).toBe(moduleExports.Svg);
        expect(moduleExports.__esModule).toBe(true);
    });
});

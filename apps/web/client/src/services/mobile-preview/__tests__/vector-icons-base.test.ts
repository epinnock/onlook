import { describe, expect, test } from 'bun:test';
import React from 'react';

type ShimRegistry = Record<string, unknown>;

type BaseTarget = {
    React: typeof React;
    TextC: string;
    View: string;
    __onlookShims?: ShimRegistry;
};

const installVectorIconsBase = require('../../../../../../../packages/mobile-preview/runtime/shims/third-party/vector-icons-base.js');

const {
    DEFAULT_ICON_COLOR,
    DEFAULT_ICON_SIZE,
    MODULE_ID,
    RUNTIME_SHIM_REGISTRY_KEY,
}: {
    DEFAULT_ICON_COLOR: string;
    DEFAULT_ICON_SIZE: number;
    MODULE_ID: string;
    RUNTIME_SHIM_REGISTRY_KEY: '__onlookShims';
} = installVectorIconsBase;

function createTarget(): BaseTarget {
    return {
        React,
        TextC: 'Text',
        View: 'View',
    };
}

describe('vector-icons base shim', () => {
    test('installs into __onlookShims and merges with existing registry entries', () => {
        const existingCreateIconSet = () => null;
        const target = {
            ...createTarget(),
            __onlookShims: {
                [MODULE_ID]: {
                    createIconSet: existingCreateIconSet,
                },
            },
        };

        const moduleExports = installVectorIconsBase(target);

        expect(target[RUNTIME_SHIM_REGISTRY_KEY][MODULE_ID]).toBe(moduleExports);
        expect(moduleExports).toBe(target.__onlookShims[MODULE_ID]);
        expect(moduleExports.createIconSet).toBe(existingCreateIconSet);
        expect(moduleExports.DEFAULT_ICON_SIZE).toBe(DEFAULT_ICON_SIZE);
        expect(moduleExports.DEFAULT_ICON_COLOR).toBe(DEFAULT_ICON_COLOR);
        expect(moduleExports.default).toBe(moduleExports);
        expect(moduleExports.__esModule).toBe(true);
    });

    test('creates icon components that fall back until the font is loaded', async () => {
        const target = createTarget();
        const moduleExports = installVectorIconsBase(target);
        const Icon = moduleExports.createIconSet(
            {
                heart: 0xf004,
                smile: '☺',
            },
            'FontAwesome',
            'font-awesome.ttf',
            { letterSpacing: 1 },
            {
                fallbackGlyphMap: {
                    heart: '♥',
                },
                target,
            },
        );

        const fallbackElement = Icon({
            accessibilityLabel: 'heart icon',
            color: '#ff0000',
            name: 'heart',
            testID: 'heart-icon',
        });

        expect(fallbackElement.type).toBe('Text');
        expect(fallbackElement.props.children).toBe('♥');
        expect(fallbackElement.props.style).toEqual([
            {
                color: '#ff0000',
                fontSize: DEFAULT_ICON_SIZE,
            },
            {
                letterSpacing: 1,
            },
        ]);
        expect(Icon.getFontFamily()).toBe('FontAwesome');
        expect(Icon.getRawGlyphMap()).toEqual({
            heart: 0xf004,
            smile: '☺',
        });
        expect(Icon.hasIcon('heart')).toBe(true);
        expect(Icon.hasIcon('missing')).toBe(false);
        expect(Icon.font).toEqual({
            FontAwesome: 'font-awesome.ttf',
        });

        await expect(Icon.loadFont()).resolves.toBe(undefined);

        const loadedElement = Icon({
            children: ' child',
            name: 'heart',
            size: 24,
            style: { opacity: 0.5 },
        });

        expect(loadedElement.props.children).toEqual(['', ' child']);
        expect(loadedElement.props.style).toEqual([
            {
                color: DEFAULT_ICON_COLOR,
                fontSize: 24,
            },
            { opacity: 0.5 },
            {
                fontFamily: 'FontAwesome',
                fontStyle: 'normal',
                fontWeight: 'normal',
            },
            {
                letterSpacing: 1,
            },
        ]);
    });

    test('exposes icon buttons and image rendering through the expo-font shim', async () => {
        const target = createTarget();
        const moduleExports = installVectorIconsBase(target);
        const Icon = moduleExports.createIconSet(
            {
                star: '*',
            },
            'Feather',
            'feather.ttf',
            null,
            { target },
        );

        const Button = Icon.Button;
        const buttonElement = Button({
            accessibilityRole: 'button',
            children: 'Favorite',
            color: '#00ff00',
            name: 'star',
            size: 18,
            style: { padding: 8 },
            testID: 'favorite-button',
        });

        expect(buttonElement.type).toBe('View');
        expect(buttonElement.props.testID).toBe('favorite-button');
        expect(buttonElement.props.style).toEqual({ padding: 8 });
        expect(buttonElement.props.children[0].type.displayName).toBe('FeatherIcon');
        expect(buttonElement.props.children[1]).toBe('Favorite');

        await expect(
            Icon.getImageSource('star', 20, '#123456'),
        ).resolves.toEqual({
            uri: 'data:text/plain,*',
            width: 0,
            height: 0,
            scale: 1,
        });
    });
});

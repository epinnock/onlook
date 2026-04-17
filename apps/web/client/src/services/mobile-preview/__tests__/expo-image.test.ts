import { afterEach, describe, expect, test } from 'bun:test';
import React from 'react';

const {
    getRegisteredRuntimeShimIds,
    registerRuntimeShim,
    resetRuntimeShimRegistry,
} = require('../../../../../../../packages/mobile-preview/runtime/registry.js');
const expoRuntimeShimCollection = require('../../../../../../../packages/mobile-preview/runtime/shims/expo/index.js');
const installExpoImageShim = require('../../../../../../../packages/mobile-preview/runtime/shims/expo/expo-image.js');

const { MODULE_ID, RUNTIME_SHIM_REGISTRY_KEY } = installExpoImageShim as {
    MODULE_ID: 'expo-image';
    RUNTIME_SHIM_REGISTRY_KEY: '__onlookShims';
};

type ShimRegistryEntry = {
    Image?: unknown;
    [key: string]: unknown;
};

type RuntimeTarget = {
    React?: typeof React;
    View?: string;
    __onlookShims?: Record<string, ShimRegistryEntry>;
};

function createTarget(overrides: Partial<RuntimeTarget> = {}): RuntimeTarget {
    return {
        React,
        View: 'View',
        ...overrides,
    };
}

afterEach(() => {
    resetRuntimeShimRegistry();
});

describe('expo-image shim', () => {
    test('installs the module into __onlookShims and renders preview-safe image components', () => {
        const target = createTarget();

        const moduleExports = installExpoImageShim(target);

        expect(target[RUNTIME_SHIM_REGISTRY_KEY]?.[MODULE_ID]).toBe(
            moduleExports,
        );
        expect(moduleExports.default).toBe(moduleExports.Image);
        expect(moduleExports.__esModule).toBe(true);

        const image = moduleExports.Image({
            source: { uri: 'https://example.com/hero.png' },
            placeholder: { blurhash: 'LEHV6nWB2yk8pyo0adR*.7kCMdnj' },
            contentFit: 'cover',
            transition: 250,
            style: { width: 120, height: 80 },
            testID: 'expo-image',
            accessibilityLabel: 'Hero image',
        });

        expect(image.type).toBe('View');
        expect(image.props.source).toEqual({
            uri: 'https://example.com/hero.png',
        });
        expect(image.props.placeholder).toEqual({
            blurhash: 'LEHV6nWB2yk8pyo0adR*.7kCMdnj',
        });
        expect(image.props.contentFit).toBe('cover');
        expect(image.props.transition).toBe(250);
        expect(image.props.style).toEqual({ width: 120, height: 80 });
        expect(image.props.testID).toBe('expo-image');
        expect(image.props.accessibilityLabel).toBe('Hero image');
        expect(image.props.children).toBeUndefined();

        const imageBackground = moduleExports.ImageBackground({
            source: { uri: 'https://example.com/background.png' },
            style: { padding: 16 },
            imageStyle: { opacity: 0.5 },
            testID: 'expo-background',
            children: 'Foreground content',
        });

        const backgroundChildren = React.Children.toArray(
            imageBackground.props.children as React.ReactNode,
        ) as Array<React.ReactElement<Record<string, unknown>> | string>;

        expect(imageBackground.type).toBe('View');
        expect(imageBackground.props.style).toEqual({ padding: 16 });
        expect(imageBackground.props.testID).toBe('expo-background');
        expect(backgroundChildren).toHaveLength(2);
        const firstChild = backgroundChildren[0] as
            | React.ReactElement<Record<string, unknown>>
            | undefined;
        expect(firstChild?.type).toBe('View');
        expect(firstChild?.props.source).toEqual({
            uri: 'https://example.com/background.png',
        });
        expect(firstChild?.props.style).toEqual({ opacity: 0.5 });
        expect(backgroundChildren[1]).toBe('Foreground content');
    });

    test('exposes preview-safe cache helpers, loading helpers, and merge behavior', async () => {
        function ExistingImage() {
            return null;
        }

        const target = createTarget({
            __onlookShims: {
                'expo-image': {
                    Image: ExistingImage,
                },
            },
        });

        const moduleExports = installExpoImageShim(target);
        const imageRef = await moduleExports.loadAsync('asset://hero.png');

        expect(moduleExports).toBe(target.__onlookShims?.['expo-image']);
        expect(moduleExports.Image).toBe(
            target.__onlookShims?.['expo-image']?.Image,
        );
        expect(moduleExports.ImageBackground).toBeFunction();
        expect(moduleExports.useImage(null)).toBeNull();
        expect(moduleExports.useImage('asset://hero.png')).toMatchObject({
            source: 'asset://hero.png',
            width: 0,
            height: 0,
            scale: 1,
            isAnimated: false,
        });
        expect(moduleExports.default).toBe(
            target.__onlookShims?.['expo-image']?.Image,
        );
        expect(moduleExports.__esModule).toBe(true);
        expect(await moduleExports.clearDiskCache()).toBe(false);
        expect(await moduleExports.Image.clearMemoryCache()).toBe(false);
        expect(await moduleExports.prefetch(['asset://hero.png'])).toBe(true);
        expect(await moduleExports.getCachePathAsync('hero')).toBeNull();
        expect(await moduleExports.generateBlurhashAsync('asset://hero.png')).toBeNull();
        expect(await moduleExports.generateThumbhashAsync('asset://hero.png')).toBe(
            '',
        );
        expect(imageRef).toEqual({
            source: 'asset://hero.png',
            width: 0,
            height: 0,
            scale: 1,
            isAnimated: false,
            lockResourceAsync: expect.any(Function),
            reloadAsync: expect.any(Function),
            startAnimating: expect.any(Function),
            stopAnimating: expect.any(Function),
            unlockResourceAsync: expect.any(Function),
        });
    });
});

describe('expo runtime shim auto-discovery', () => {
    test('derives expo-image from the shared Expo shim collection', () => {
        registerRuntimeShim(expoRuntimeShimCollection, './shims/expo/index.js');
        registerRuntimeShim(
            {
                install() {},
            },
            './shims/expo/expo-image.js',
        );

        expect(getRegisteredRuntimeShimIds()).toEqual(['expo-image']);
    });
});

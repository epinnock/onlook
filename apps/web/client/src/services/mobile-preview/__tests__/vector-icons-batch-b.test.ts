import { describe, expect, test } from 'bun:test';
import React from 'react';

type ShimRegistry = Record<string, unknown>;

type BatchBTarget = {
    React: typeof React;
    TextC: string;
    View: string;
    __onlookShims?: ShimRegistry;
};

const installVectorIconsBatchB = require('../../../../../../../packages/mobile-preview/runtime/shims/third-party/vector-icons-batch-b.js');

const { MODULE_IDS } = installVectorIconsBatchB;

function createTarget(): BatchBTarget {
    return {
        React,
        TextC: 'Text',
        View: 'View',
    };
}

describe('vector-icons batch B shim', () => {
    test('installs family modules into __onlookShims', async () => {
        const target = createTarget();

        const installed = installVectorIconsBatchB(target);

        expect(Object.keys(installed)).toEqual([
            MODULE_IDS.EvilIcons,
            MODULE_IDS.Foundation,
            MODULE_IDS.MaterialCommunityIcons,
            MODULE_IDS.Octicons,
            MODULE_IDS.SimpleLineIcons,
            MODULE_IDS.Zocial,
        ]);
        const registry = target.__onlookShims;
        if (!registry) {
            throw new Error('expected runtime shim registry to be installed');
        }
        expect(registry[MODULE_IDS.EvilIcons]).toBe(
            installed[MODULE_IDS.EvilIcons],
        );
        expect(registry[MODULE_IDS.Zocial]).toBe(
            installed[MODULE_IDS.Zocial],
        );

        const EvilIcons = installed[MODULE_IDS.EvilIcons];
        const fallbackElement = EvilIcons({
            accessibilityLabel: 'close icon',
            color: '#ff00ff',
            name: 'close',
            testID: 'close-icon',
        });

        expect(fallbackElement.type).toBe('Text');
        expect(fallbackElement.props.children).toBe('✕');
        expect(fallbackElement.props.style).toEqual([
            {
                color: '#ff00ff',
                fontSize: 12,
            },
        ]);

        await expect(EvilIcons.loadFont()).resolves.toBe(undefined);

        const loadedElement = EvilIcons({
            children: ' now',
            name: 'close',
            size: 20,
            style: { opacity: 0.75 },
        });

        expect(loadedElement.props.children).toEqual(['', ' now']);
        expect(loadedElement.props.style).toEqual([
            {
                color: 'black',
                fontSize: 20,
            },
            { opacity: 0.75 },
            {
                fontFamily: 'EvilIcons',
                fontStyle: 'normal',
                fontWeight: 'normal',
            },
        ]);
    });

    test('merges into existing registry entries for installed families', () => {
        const existingOcticons = Symbol('Octicons');
        const target = {
            ...createTarget(),
            __onlookShims: {
                [MODULE_IDS.Octicons]: {
                    Existing: existingOcticons,
                },
            },
        };

        const installed = installVectorIconsBatchB(target);
        const octicons = installed[MODULE_IDS.Octicons];
        const foundation = installed[MODULE_IDS.Foundation];

        expect(octicons).toBe(target.__onlookShims[MODULE_IDS.Octicons]);
        expect(octicons.Existing).toBe(existingOcticons);
        expect(octicons.Button).toBeFunction();
        expect(octicons.default).toBe(octicons);
        expect(octicons.__esModule).toBe(true);

        expect(foundation).toBe(target.__onlookShims[MODULE_IDS.Foundation]);
        expect(foundation.getFontFamily()).toBe('Foundation');
    });

    test('exposes icon buttons and image rendering for batch B families', async () => {
        const target = createTarget();
        const installed = installVectorIconsBatchB(target);
        const MaterialCommunityIcons =
            installed[MODULE_IDS.MaterialCommunityIcons];

        const buttonElement = MaterialCommunityIcons.Button({
            accessibilityRole: 'button',
            children: 'Profile',
            color: '#00ff00',
            name: 'account',
            size: 18,
            style: { padding: 8 },
            testID: 'profile-button',
        });

        expect(buttonElement.type).toBe('View');
        expect(buttonElement.props.testID).toBe('profile-button');
        expect(buttonElement.props.style).toEqual({ padding: 8 });
        expect(
            buttonElement.props.children[0].type.displayName,
        ).toBe('Material Community IconsIcon');
        expect(buttonElement.props.children[1]).toBe('Profile');

        const zocial = installed[MODULE_IDS.Zocial];
        await expect(
            zocial.getImageSource('github', 16, '#123456'),
        ).resolves.toEqual({
            uri: 'data:text/plain,%EF%8C%80',
            width: 0,
            height: 0,
            scale: 1,
        });
    });
});

import { describe, expect, test } from 'bun:test';
import React from 'react';

type FamilyModule = {
    getFontFamily: () => string;
    loadFont: () => Promise<undefined>;
    getRawGlyphMap: () => Record<string, number | string>;
    getImageSource: (
        name: string,
        size: number,
        color: string,
    ) => Promise<{ uri: string; width: number; height: number; scale: number }>;
    hasIcon: (name: string) => boolean;
    default: FamilyModule;
    __esModule: boolean;
    (props: Record<string, unknown>): {
        type: string;
        props: { children: string | number };
    };
};

type BatchAModuleIds = {
    readonly antDesign: '@expo/vector-icons/AntDesign';
    readonly entypo: '@expo/vector-icons/Entypo';
    readonly feather: '@expo/vector-icons/Feather';
    readonly fontAwesome: '@expo/vector-icons/FontAwesome';
    readonly ionicons: '@expo/vector-icons/Ionicons';
    readonly materialIcons: '@expo/vector-icons/MaterialIcons';
};

type BatchAModuleId = BatchAModuleIds[keyof BatchAModuleIds];

type InstalledModules = { [K in BatchAModuleId]: FamilyModule };

type ShimRegistry = { [K in BatchAModuleId]?: FamilyModule | unknown };

type BatchATarget = {
    React: typeof React;
    TextC: string;
    View: string;
    __onlookShims?: ShimRegistry;
};

type InstallVectorIconsBatchA = ((target: BatchATarget) => InstalledModules) & {
    MODULE_IDS: BatchAModuleIds;
    RUNTIME_SHIM_REGISTRY_KEY: '__onlookShims';
};

const installVectorIconsBatchA: InstallVectorIconsBatchA = require('../../../../../../../packages/mobile-preview/runtime/shims/third-party/vector-icons-batch-a.js');

const { MODULE_IDS, RUNTIME_SHIM_REGISTRY_KEY } = installVectorIconsBatchA;

function createTarget(): BatchATarget {
    return {
        React,
        TextC: 'Text',
        View: 'View',
    };
}

function resolveGlyph(moduleExports: {
    getRawGlyphMap: () => Record<string, number | string>;
}, name: string): string {
    const glyph = moduleExports.getRawGlyphMap()[name];
    if (glyph === undefined) {
        throw new Error(`glyph '${name}' not found in glyph map`);
    }
    return typeof glyph === 'number' ? String.fromCodePoint(glyph) : glyph;
}

describe('vector icons batch A shim', () => {
    test('installs batch A families into __onlookShims', async () => {
        const target = createTarget();

        const installedModules = installVectorIconsBatchA(target);
        const ionicons = installedModules[MODULE_IDS.ionicons];
        const materialIcons = installedModules[MODULE_IDS.materialIcons];
        const fontAwesome = installedModules[MODULE_IDS.fontAwesome];
        const feather = installedModules[MODULE_IDS.feather];
        const antDesign = installedModules[MODULE_IDS.antDesign];
        const entypo = installedModules[MODULE_IDS.entypo];

        const registry = target[RUNTIME_SHIM_REGISTRY_KEY];
        if (!registry) {
            throw new Error('expected runtime shim registry to be installed');
        }

        expect(registry[MODULE_IDS.ionicons]).toBe(ionicons);
        expect(registry[MODULE_IDS.materialIcons]).toBe(materialIcons);
        expect(registry[MODULE_IDS.fontAwesome]).toBe(fontAwesome);
        expect(registry[MODULE_IDS.feather]).toBe(feather);
        expect(registry[MODULE_IDS.antDesign]).toBe(antDesign);
        expect(registry[MODULE_IDS.entypo]).toBe(entypo);

        expect(ionicons.getFontFamily()).toBe('ionicons');
        expect(materialIcons.getFontFamily()).toBe('material');
        expect(fontAwesome.getFontFamily()).toBe('FontAwesome');
        expect(feather.getFontFamily()).toBe('feather');
        expect(antDesign.getFontFamily()).toBe('anticon');
        expect(entypo.getFontFamily()).toBe('entypo');

        await expect(ionicons.loadFont()).resolves.toBe(undefined);
        await expect(materialIcons.loadFont()).resolves.toBe(undefined);
        await expect(fontAwesome.loadFont()).resolves.toBe(undefined);
        await expect(feather.loadFont()).resolves.toBe(undefined);
        await expect(antDesign.loadFont()).resolves.toBe(undefined);
        await expect(entypo.loadFont()).resolves.toBe(undefined);
        expect(ionicons({ name: 'accessibility' }).props.children).toBe(
            resolveGlyph(ionicons, 'accessibility'),
        );
        expect(materialIcons({ name: '123' }).props.children).toBe(
            resolveGlyph(materialIcons, '123'),
        );
        expect(fontAwesome({ name: 'glass' }).props.children).toBe(
            resolveGlyph(fontAwesome, 'glass'),
        );
        expect(feather({ name: 'activity' }).props.children).toBe(
            resolveGlyph(feather, 'activity'),
        );
        expect(antDesign({ name: 'account-book' }).props.children).toBe(
            resolveGlyph(antDesign, 'account-book'),
        );
        expect(entypo({ name: '500px' }).props.children).toBe(
            resolveGlyph(entypo, '500px'),
        );

        await expect(
            ionicons.getImageSource('accessibility', 18, '#123456'),
        ).resolves.toEqual({
            uri: 'data:text/plain,%EF%84%80',
            width: 0,
            height: 0,
            scale: 1,
        });
    });

    test('preserves existing family modules already present in the registry', () => {
        const existingIonicons = { existing: true } as unknown as FamilyModule;
        const target: BatchATarget = {
            ...createTarget(),
            __onlookShims: {
                [MODULE_IDS.ionicons]: existingIonicons,
            },
        };

        const installedModules = installVectorIconsBatchA(target);

        expect(installedModules[MODULE_IDS.ionicons]).toBe(existingIonicons);
        expect(installedModules[MODULE_IDS.materialIcons].getFontFamily()).toBe(
            'material',
        );
        expect(installedModules[MODULE_IDS.fontAwesome].hasIcon('glass')).toBe(
            true,
        );
        expect(installedModules[MODULE_IDS.feather].default).toBe(
            installedModules[MODULE_IDS.feather],
        );
        expect(installedModules[MODULE_IDS.antDesign].__esModule).toBe(true);
    });
});

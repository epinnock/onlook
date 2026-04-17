import { describe, expect, test } from 'bun:test';
import React from 'react';

const installVectorIconsBatchA = require('../../../../../../../packages/mobile-preview/runtime/shims/third-party/vector-icons-batch-a.js');

const { MODULE_IDS, RUNTIME_SHIM_REGISTRY_KEY } = installVectorIconsBatchA;

function createTarget() {
    return {
        React,
        TextC: 'Text',
        View: 'View',
    };
}

function resolveGlyph(moduleExports: {
    getRawGlyphMap: () => Record<string, number | string>;
}, name: string) {
    const glyph = moduleExports.getRawGlyphMap()[name];
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

        expect(target[RUNTIME_SHIM_REGISTRY_KEY][MODULE_IDS.ionicons]).toBe(
            ionicons,
        );
        expect(target[RUNTIME_SHIM_REGISTRY_KEY][MODULE_IDS.materialIcons]).toBe(
            materialIcons,
        );
        expect(target[RUNTIME_SHIM_REGISTRY_KEY][MODULE_IDS.fontAwesome]).toBe(
            fontAwesome,
        );
        expect(target[RUNTIME_SHIM_REGISTRY_KEY][MODULE_IDS.feather]).toBe(
            feather,
        );
        expect(target[RUNTIME_SHIM_REGISTRY_KEY][MODULE_IDS.antDesign]).toBe(
            antDesign,
        );
        expect(target[RUNTIME_SHIM_REGISTRY_KEY][MODULE_IDS.entypo]).toBe(
            entypo,
        );

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
        const existingIonicons = { existing: true };
        const target = {
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

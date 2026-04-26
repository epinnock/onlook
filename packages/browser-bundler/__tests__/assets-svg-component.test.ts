import { describe, expect, test } from 'bun:test';

import {
    buildSvgComponentModule,
    createAssetsSvgComponentPlugin,
    hasBypassQuery,
    stripQuery,
    type EsbuildLoadBuild,
    type EsbuildLoadResult,
    type SvgAssetFileMap,
} from '../src/plugins/assets-svg-component';

function createPluginHarness(
    files: SvgAssetFileMap,
    overrides?: { svgRendererSpecifier?: string; svgRendererExport?: string },
) {
    let callback:
        | ((args: { path: string; namespace?: string; suffix?: string }) => EsbuildLoadResult | undefined | void)
        | undefined;
    let filter: RegExp | undefined;

    const build: EsbuildLoadBuild = {
        onLoad(options, handler) {
            filter = options.filter;
            callback = handler;
        },
    };

    createAssetsSvgComponentPlugin({ files, ...overrides }).setup(build);
    if (callback === undefined || filter === undefined) {
        throw new Error('plugin did not register an onLoad handler');
    }
    return {
        filter,
        load(path: string, suffix?: string) {
            return callback?.({ path, suffix });
        },
    };
}

describe('buildSvgComponentModule', () => {
    test('emits an ES module that imports React + SvgXml', () => {
        const src = buildSvgComponentModule({
            xml: '<svg viewBox="0 0 10 10"/>',
            rendererSpecifier: 'react-native-svg',
            rendererExport: 'SvgXml',
        });
        expect(src).toContain(`import React from "react";`);
        expect(src).toContain(`import { SvgXml } from "react-native-svg";`);
    });

    test('embeds the SVG XML as a JSON-encoded string constant', () => {
        const xml = '<svg viewBox="0 0 1 1"><path d="M0,0L1,1"/></svg>';
        const src = buildSvgComponentModule({
            xml,
            rendererSpecifier: 'react-native-svg',
            rendererExport: 'SvgXml',
        });
        expect(src).toContain(JSON.stringify(xml));
    });

    test('forwards caller props onto SvgXml + sets xml prop', () => {
        const src = buildSvgComponentModule({
            xml: '<svg/>',
            rendererSpecifier: 'react-native-svg',
            rendererExport: 'SvgXml',
        });
        // Pattern: React.createElement(SvgXml, Object.assign({}, props, { xml: __ONLOOK_SVG_XML__ }))
        expect(src).toContain('React.createElement(SvgXml');
        expect(src).toContain('Object.assign({}, props,');
        expect(src).toContain('xml: __ONLOOK_SVG_XML__');
    });

    test('export default is the OnlookSvg component', () => {
        const src = buildSvgComponentModule({
            xml: '<svg/>',
            rendererSpecifier: 'react-native-svg',
            rendererExport: 'SvgXml',
        });
        expect(src).toContain('function OnlookSvg(props)');
        expect(src).toContain('export default OnlookSvg;');
    });

    test('honors a custom rendererSpecifier and rendererExport', () => {
        const src = buildSvgComponentModule({
            xml: '<svg/>',
            rendererSpecifier: '@my/svg-lib',
            rendererExport: 'CustomRenderer',
        });
        expect(src).toContain(`import { CustomRenderer } from "@my/svg-lib";`);
        expect(src).toContain('React.createElement(CustomRenderer');
    });

    test('XML containing quotes + backslashes is JSON-escaped (parseable)', () => {
        const tricky = '<svg fill="\"escape\""><path d="M\\0,0"/></svg>';
        const src = buildSvgComponentModule({
            xml: tricky,
            rendererSpecifier: 'react-native-svg',
            rendererExport: 'SvgXml',
        });
        // Pull the JSON literal back out and parse — it must round-trip.
        const match = /__ONLOOK_SVG_XML__ = (.+);/.exec(src);
        expect(match).not.toBeNull();
        expect(JSON.parse(match![1]!)).toBe(tricky);
    });
});

describe('hasBypassQuery + stripQuery (parity with sibling plugins)', () => {
    test('hasBypassQuery detects ?url / ?raw both forms', () => {
        expect(hasBypassQuery('icon.svg')).toBe(false);
        expect(hasBypassQuery('icon.svg?url')).toBe(true);
        expect(hasBypassQuery('icon.svg?raw')).toBe(true);
        expect(hasBypassQuery('icon.svg', '?url')).toBe(true);
        expect(hasBypassQuery('icon.svg', '?raw')).toBe(true);
        expect(hasBypassQuery('icon.svg?other')).toBe(false);
    });

    test('stripQuery drops everything after the first ?', () => {
        expect(stripQuery('icon.svg')).toBe('icon.svg');
        expect(stripQuery('icon.svg?url')).toBe('icon.svg');
        expect(stripQuery('icon.svg?raw&v=1')).toBe('icon.svg');
    });
});

describe('createAssetsSvgComponentPlugin', () => {
    test('filter matches plain .svg', () => {
        const harness = createPluginHarness({});
        expect(harness.filter.test('icon.svg')).toBe(true);
        expect(harness.filter.test('logo.SVG')).toBe(true);
    });

    test('filter matches ?url + ?raw suffix forms (so plugin can opt out)', () => {
        const harness = createPluginHarness({});
        expect(harness.filter.test('icon.svg?url')).toBe(true);
        expect(harness.filter.test('icon.svg?raw')).toBe(true);
    });

    test('filter does NOT match other extensions', () => {
        const harness = createPluginHarness({});
        expect(harness.filter.test('icon.png')).toBe(false);
        expect(harness.filter.test('font.ttf')).toBe(false);
    });

    test('emits a component module for plain .svg import', () => {
        const harness = createPluginHarness({
            'icon.svg': '<svg viewBox="0 0 10 10"/>',
        });
        const out = harness.load('icon.svg');
        expect(out?.contents).toContain(`import React from "react";`);
        expect(out?.contents).toContain(`import { SvgXml } from "react-native-svg";`);
        expect(out?.contents).toContain('export default OnlookSvg;');
        expect(out?.contents).toContain(JSON.stringify('<svg viewBox="0 0 10 10"/>'));
    });

    test('returns undefined for ?url import (sibling R2 plugin claims it)', () => {
        const harness = createPluginHarness({
            'icon.svg': '<svg/>',
        });
        expect(harness.load('icon.svg?url')).toBeUndefined();
    });

    test('returns undefined for ?raw import (sibling raw-text plugin claims it)', () => {
        const harness = createPluginHarness({
            'icon.svg': '<svg/>',
        });
        expect(harness.load('icon.svg?raw')).toBeUndefined();
    });

    test('returns undefined when esbuild suffix is ?url even with no path query', () => {
        const harness = createPluginHarness({
            'icon.svg': '<svg/>',
        });
        expect(harness.load('icon.svg', '?url')).toBeUndefined();
    });

    test('returns undefined when SVG file is not in the virtual map', () => {
        const harness = createPluginHarness({});
        expect(harness.load('missing.svg')).toBeUndefined();
    });

    test('Uint8Array contents are UTF-8 decoded into the embedded XML', () => {
        const xml = '<svg/>';
        const bytes = new TextEncoder().encode(xml);
        const harness = createPluginHarness({
            'icon.svg': bytes,
        });
        const out = harness.load('icon.svg');
        expect(out?.contents).toContain(JSON.stringify(xml));
    });

    test('honors custom svgRendererSpecifier + svgRendererExport options', () => {
        const harness = createPluginHarness(
            { 'icon.svg': '<svg/>' },
            { svgRendererSpecifier: '@onlook/test-svg', svgRendererExport: 'TestSvg' },
        );
        const out = harness.load('icon.svg');
        expect(out?.contents).toContain(`import { TestSvg } from "@onlook/test-svg";`);
        expect(out?.contents).toContain('React.createElement(TestSvg');
    });
});

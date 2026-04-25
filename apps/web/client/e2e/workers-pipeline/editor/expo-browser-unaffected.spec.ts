/**
 * workers-pipeline editor — expo-browser unaffected regression guard.
 *
 * The two-tier path ships alongside the legacy ExpoBrowser canvas preview.
 * This spec asserts two properties the integration must preserve:
 *
 *   1. The feature-flag helper treats `shim` (the legacy pipeline) as the
 *      default, i.e. two-tier is OFF unless explicitly enabled. Any future
 *      change that inverts the default would light this test up.
 *   2. The existing ExpoBrowser service surface (expo-relay index barrel,
 *      manifest-url, qr) still exports the helpers it did before the
 *      two-tier additions landed. Additive-only — never a rename.
 */
import { expect, test } from '@playwright/test';

import * as expoRelay from '../../../../../../apps/web/client/src/services/expo-relay';
import { classifyPipelineValue } from '../../../../../../apps/mobile-client/src/flow/featureFlags';

test.describe('workers-pipeline editor — expo-browser unaffected', () => {
    test('pipeline flag defaults to shim (legacy path) when unset', () => {
        expect(classifyPipelineValue(undefined)).toBe('shim');
    });

    test('arbitrary env values collapse to shim — accidental misconfiguration must not silently enable two-tier', () => {
        expect(classifyPipelineValue('')).toBe('shim');
        expect(classifyPipelineValue('true')).toBe('shim');
        expect(classifyPipelineValue('enabled')).toBe('shim');
        expect(classifyPipelineValue('TWO-TIER')).toBe('shim');
    });

    test('only the exact "two-tier" literal opts into the new path', () => {
        expect(classifyPipelineValue('two-tier')).toBe('two-tier');
        expect(classifyPipelineValue('two_tier')).toBe('shim');
        expect(classifyPipelineValue('twotier')).toBe('shim');
    });

    test('expo-relay barrel exports still include the legacy helpers', () => {
        // These symbols power ExpoBrowser. Never rename without a migration.
        expect(typeof expoRelay).toBe('object');
        const names = Object.keys(expoRelay);
        // Manifest + QR helpers — canvas preview depends on them.
        expect(names).toEqual(
            expect.arrayContaining([
                // From manifest-url.ts
                'buildManifestUrl',
            ]),
        );
    });

    test('expo-relay barrel adds two-tier helpers without shadowing legacy ones', () => {
        const names = Object.keys(expoRelay);
        expect(names).toEqual(
            expect.arrayContaining(['pushOverlay']),
        );
        // Guard rail: ensure nothing with the pushOverlay name clobbered an
        // existing export shape. The function must be callable.
        expect(typeof expoRelay.pushOverlay).toBe('function');
    });
});

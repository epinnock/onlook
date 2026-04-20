import { expect, test } from '@playwright/test';

import {
    bundleFixtureAsOverlay,
    DEFAULT_BASE_EXTERNALS,
    loadFixtureForBundling,
} from '../helpers/browser-bundler-harness';

const TABS_SIZE_BUDGET = 400 * 1024; // 400KB ceiling per the validation plan.
const TABS_TIME_BUDGET_MS = 500; // wall-clock ceiling per the validation plan.

test.describe('workers-pipeline browser-bundler — tabs-template fixture', () => {
    test('bundles multi-file project through the virtual FS + externalized base imports', async () => {
        const { wrapped, bundle } = await bundleFixtureAsOverlay('tabs-template');

        expect(wrapped.code).toContain('globalThis["__onlookMountOverlay"]');
        expect(wrapped.code).toContain('mount(');

        // None of the base externals should have been statically inlined into
        // the overlay output — the mobile-client base bundle provides them.
        for (const specifier of DEFAULT_BASE_EXTERNALS) {
            expect(bundle.code).not.toMatch(
                new RegExp(`^\\s*(?:import|require)\\s*[^;\\n]*['"]${escapeRegex(specifier)}['"]`, 'm'),
            );
        }
    });

    test('traverses src/** imports (navigation, screens, theme) via virtual FS', async () => {
        // Sanity — the harness must surface all the files the entry graph
        // needs. If any of these are missing from the virtual file set the
        // bundle would fail outright, but we spot-check loader inputs too.
        const { files } = loadFixtureForBundling('tabs-template');
        const paths = files.map((f) => f.path);
        expect(paths).toContain('/src/navigation/Tabs.tsx');
        expect(paths).toContain('/src/screens/HomeScreen.tsx');
        expect(paths).toContain('/src/theme.ts');
    });

    test('emits a parseable source map', async () => {
        const { bundle } = await bundleFixtureAsOverlay('tabs-template');

        expect(bundle.sourceMap).toBeDefined();
        const parsed = JSON.parse(bundle.sourceMap!) as {
            version: number;
            sources?: readonly string[];
        };
        expect(parsed.version).toBe(3);
        expect((parsed.sources ?? []).length).toBeGreaterThanOrEqual(2);
    });

    test(`overlay is smaller than ${TABS_SIZE_BUDGET} bytes`, async () => {
        const { byteLength } = await bundleFixtureAsOverlay('tabs-template');
        expect(byteLength).toBeLessThan(TABS_SIZE_BUDGET);
    });

    test(`bundle completes in under ${TABS_TIME_BUDGET_MS}ms`, async () => {
        const { durationMs } = await bundleFixtureAsOverlay('tabs-template');
        expect(durationMs).toBeLessThan(TABS_TIME_BUDGET_MS);
    });
});

function escapeRegex(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

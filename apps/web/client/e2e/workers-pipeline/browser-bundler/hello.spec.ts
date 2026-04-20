import { expect, test } from '@playwright/test';

import { bundleFixtureAsOverlay } from '../helpers/browser-bundler-harness';

const HELLO_SIZE_BUDGET = 100 * 1024; // 100KB ceiling per the validation plan.
const HELLO_TIME_BUDGET_MS = 250; // wall-clock ceiling per the validation plan.

test.describe('workers-pipeline browser-bundler — hello fixture', () => {
    test('produces a CJS overlay wrapped with globalThis.__onlookMountOverlay', async () => {
        const { wrapped } = await bundleFixtureAsOverlay('hello');

        // IIFE-wrapped, references the mount global, and inlines the bundled
        // CJS as a string argument to mount(). We check shape rather than
        // exact bytes so minor esbuild codegen tweaks don't break the test.
        expect(wrapped.code).toMatch(/^\s*\(function\(\)\s*\{/);
        expect(wrapped.code).toContain('globalThis["__onlookMountOverlay"]');
        expect(wrapped.code).toContain('mount(');
    });

    test('emits a parseable source map', async () => {
        const { bundle } = await bundleFixtureAsOverlay('hello');

        expect(bundle.sourceMap).toBeDefined();
        const parsed = JSON.parse(bundle.sourceMap!) as {
            version: number;
            sources?: readonly string[];
            mappings?: string;
        };
        expect(parsed.version).toBe(3);
        expect(Array.isArray(parsed.sources)).toBe(true);
        expect((parsed.sources ?? []).length).toBeGreaterThan(0);
        expect(typeof parsed.mappings).toBe('string');
    });

    test(`overlay is smaller than ${HELLO_SIZE_BUDGET} bytes`, async () => {
        const { byteLength } = await bundleFixtureAsOverlay('hello');
        expect(byteLength).toBeLessThan(HELLO_SIZE_BUDGET);
    });

    test(`bundle completes in under ${HELLO_TIME_BUDGET_MS}ms`, async () => {
        const { durationMs } = await bundleFixtureAsOverlay('hello');
        expect(durationMs).toBeLessThan(HELLO_TIME_BUDGET_MS);
    });
});

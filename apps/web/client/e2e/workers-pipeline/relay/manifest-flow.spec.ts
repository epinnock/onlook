/**
 * workers-pipeline relay — manifest + /push flow.
 *
 * These Playwright specs drive the relay worker's bun:test suite as a
 * subprocess. Reason: the relay worker imports `cloudflare:workers` (the
 * Durable Object runtime), which needs to be stubbed per-test; bun's
 * `mock.module` covers that cleanly, while replicating the same shim in
 * Playwright's Node runtime would require a custom ESM loader and
 * substantially more plumbing for no additional coverage. The unit suites
 * verify: manifest resolves the current base-bundle pointer; base bundle
 * and asset routes emit immutable cache headers; POST /push accepts overlay
 * payloads and forwards to the HmrSession DO.
 */
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { expect, test } from '@playwright/test';

const helperDir = dirname(fileURLToPath(import.meta.url));
const relayDir = resolve(helperDir, '../../../../../../apps/cf-expo-relay');

function runBunTests(specs: readonly string[]): { status: number; stderr: string; stdout: string } {
    const result = spawnSync('bun', ['test', ...specs], {
        cwd: relayDir,
        encoding: 'utf8',
        env: { ...process.env, FORCE_COLOR: '0' },
    });
    return {
        status: result.status ?? -1,
        stderr: result.stderr ?? '',
        stdout: result.stdout ?? '',
    };
}

test.describe('workers-pipeline relay — manifest + push flow', () => {
    test('GET /manifest/:hash → handleManifest via ESM_CACHE binding (worker suite)', () => {
        const { status, stderr, stdout } = runBunTests(['src/__tests__/worker.test.ts']);
        // bun test writes its summary to stderr; include both streams in the
        // failure message so the Playwright report is actionable.
        expect(status, `bun test failed:\n${stderr}\n${stdout}`).toBe(0);
        // Zero failures + at least one pass means the underlying suite ran.
        expect(stderr + stdout).toMatch(/\d+\s+pass/);
        expect(stderr + stdout).toContain('0 fail');
    });

    test('POST /push/:id forwards to HmrSession DO with routing + binding guards (routes suite)', () => {
        const { status, stderr, stdout } = runBunTests([
            'src/__tests__/routes/push.test.ts',
        ]);
        expect(status, `bun test failed:\n${stderr}\n${stdout}`).toBe(0);
        expect(stderr + stdout).toMatch(/\d+\s+pass/);
        expect(stderr + stdout).toContain('0 fail');
    });

    test('base-bundle + assets routes emit immutable cache headers (routes suite)', () => {
        const { status, stderr, stdout } = runBunTests([
            'src/__tests__/routes/base-bundle.test.ts',
            'src/__tests__/routes/assets.test.ts',
        ]);
        expect(status, `bun test failed:\n${stderr}\n${stdout}`).toBe(0);
    });

    test('manifest contract + builder + base-version suites stay green', () => {
        const { status, stderr, stdout } = runBunTests([
            'src/__tests__/routes/manifest.test.ts',
            'src/__tests__/routes/manifest-contract.test.ts',
            'src/__tests__/manifest-builder.test.ts',
            'src/__tests__/base-version.test.ts',
        ]);
        expect(status, `bun test failed:\n${stderr}\n${stdout}`).toBe(0);
    });
});

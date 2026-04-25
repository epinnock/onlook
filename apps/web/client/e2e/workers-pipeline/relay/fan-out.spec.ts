/**
 * workers-pipeline relay — HmrSession fan-out + replay.
 *
 * Drives the bun:test suite for the HmrSession Durable Object. See
 * manifest-flow.spec.ts for the rationale behind the subprocess pattern.
 * Assertions covered by the underlying suite:
 *   - Two WS clients receive the overlay broadcast from a third sender.
 *   - Late-joining clients receive the last overlay on connect.
 *   - POST /push accepts an overlay, broadcasts to all connected sockets,
 *     and persists it for replay.
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

test.describe('workers-pipeline relay — HmrSession fan-out', () => {
    test('HmrSession broadcasts overlays and replays the last one to late joiners', () => {
        const { status, stderr, stdout } = runBunTests(['src/__tests__/do-hmr-session.test.ts']);
        expect(status, `bun test failed:\n${stderr}\n${stdout}`).toBe(0);

        const combined = stderr + stdout;
        // The fan-out + replay suite grew past 10 cases once POST /push was
        // added; guard against the file being accidentally truncated.
        const passMatch = combined.match(/(\d+)\s+pass/);
        expect(passMatch, `no pass count reported:\n${combined}`).not.toBeNull();
        const passCount = Number(passMatch![1]);
        expect(passCount).toBeGreaterThanOrEqual(10);
        expect(combined).toContain('0 fail');
    });

    test('protocol schema + overlay helpers stay green', () => {
        const result = spawnSync(
            'bun',
            ['test', 'packages/mobile-client-protocol/__tests__/overlay.test.ts'],
            {
                cwd: resolve(helperDir, '../../../../../..'),
                encoding: 'utf8',
                env: { ...process.env, FORCE_COLOR: '0' },
            },
        );
        const stderr = result.stderr ?? '';
        const stdout = result.stdout ?? '';
        expect(result.status, `bun test failed:\n${stderr}\n${stdout}`).toBe(0);
    });
});

/**
 * bundle-runtime-drift.test.ts
 *
 * Guards against silent drift between the copied `onlook-runtime.js` binary
 * artefact (checked into iOS/Android resource dirs by `bundle-runtime.ts`)
 * and its sibling `onlook-runtime.meta.json` manifest.
 *
 * The meta.json claims `{ bytes, sha256, version, copiedFrom, copiedAt }` at
 * copy time; if a human (or a merge conflict) edits the bundle in-tree
 * without re-running `bun run bundle-runtime`, the manifest becomes a lie.
 * This test re-hashes the bundle and re-stats its size, then asserts the
 * manifest still matches — catching drift in CI before it reaches a device.
 *
 * The script `bundle-runtime.ts` has no env-var output override (it exposes
 * `--dest-ios=` / `--dest-android=` / `--source=` CLI flags instead), so per
 * the task spec we validate the checked-in iOS + Android outputs directly.
 * If those files don't exist yet (e.g. a fresh checkout where
 * `bun run bundle-runtime` hasn't been invoked), the test skips gracefully
 * rather than failing CI.
 */

import { describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';

interface RuntimeMeta {
    version: string;
    sha256: string;
    copiedFrom: string;
    copiedAt: string;
    bytes: number;
}

// apps/mobile-client/scripts/__tests__/bundle-runtime-drift.test.ts
// → apps/mobile-client is two levels up from scripts/__tests__
const mobileClientRoot = resolve(import.meta.dir, '..', '..');

const targets: Array<{ platform: 'ios' | 'android'; bundle: string; meta: string }> = [
    {
        platform: 'ios',
        bundle: resolve(
            mobileClientRoot,
            'ios',
            'OnlookMobileClient',
            'Resources',
            'onlook-runtime.js',
        ),
        meta: resolve(
            mobileClientRoot,
            'ios',
            'OnlookMobileClient',
            'Resources',
            'onlook-runtime.meta.json',
        ),
    },
    {
        platform: 'android',
        bundle: resolve(
            mobileClientRoot,
            'android',
            'app',
            'src',
            'main',
            'assets',
            'onlook-runtime.js',
        ),
        meta: resolve(
            mobileClientRoot,
            'android',
            'app',
            'src',
            'main',
            'assets',
            'onlook-runtime.meta.json',
        ),
    },
];

function sha256Hex(buf: Buffer): string {
    return createHash('sha256').update(buf).digest('hex');
}

describe('bundle-runtime drift detection', () => {
    for (const target of targets) {
        describe(`${target.platform} artefacts`, () => {
            const hasBundle = existsSync(target.bundle);
            const hasMeta = existsSync(target.meta);
            const ready = hasBundle && hasMeta;

            if (!ready) {
                test.skip(
                    `skipped — ${target.platform} runtime not yet copied (run 'bun run bundle-runtime')`,
                    () => {
                        // Placeholder; present so the skip is visible in the report.
                    },
                );
                return;
            }

            test('meta.size matches fs.statSync(bundle).size', () => {
                const meta = JSON.parse(readFileSync(target.meta, 'utf8')) as RuntimeMeta;
                const actualSize = statSync(target.bundle).size;
                expect(meta.bytes).toBe(actualSize);
            });

            test('meta.sha256 is a 64-char lowercase hex string', () => {
                const meta = JSON.parse(readFileSync(target.meta, 'utf8')) as RuntimeMeta;
                expect(meta.sha256).toMatch(/^[0-9a-f]{64}$/);
            });

            test('recomputed sha256 of the bundle matches meta.sha256', () => {
                const meta = JSON.parse(readFileSync(target.meta, 'utf8')) as RuntimeMeta;
                const bundleBuf = readFileSync(target.bundle);
                expect(sha256Hex(bundleBuf)).toBe(meta.sha256);
            });
        });
    }
});

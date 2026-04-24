/**
 * Regression tests for `ensureRuntimeStaged` cache invalidation.
 *
 * Bug caught during the Phase 9 #51 E2E walkthrough: macOS's launchd
 * tmpwatch job periodically wipes `/tmp/cf-builds/*` at midnight. A
 * long-running mobile-preview server cached `currentRuntimeHash` on
 * startup and kept handing it out in /status responses forever — even
 * after the on-disk files were gone. Every manifest request then 404ed
 * until the server was restarted.
 *
 * The fix makes `ensureRuntimeStaged` check that the cached hash's
 * manifest-fields.json + iOS bundle still exist on disk before reusing
 * it; when they're gone, it re-stages from the runtime path.
 */

import { mkdtempSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';

import { ensureRuntimeStaged, getBundleStorePaths } from '../bundle-store';

// Module-level `currentRuntimeHash` leaks across tests, so we run the
// whole suite serially and tear down the temp store between cases.
let runtimeFile: string;
let storeDir: string;

function makeFakeRuntime(contents: string): string {
    const dir = mkdtempSync(join(tmpdir(), 'onlook-runtime-'));
    const file = join(dir, 'bundle.js');
    writeFileSync(file, contents);
    return file;
}

beforeEach(() => {
    storeDir = mkdtempSync(join(tmpdir(), 'onlook-store-'));
    runtimeFile = makeFakeRuntime('// test-runtime-v1\n');
});

afterEach(() => {
    try {
        rmSync(storeDir, { recursive: true, force: true });
    } catch {
        /* ignore */
    }
    try {
        rmSync(runtimeFile.replace(/\/bundle\.js$/, ''), {
            recursive: true,
            force: true,
        });
    } catch {
        /* ignore */
    }
});

describe('ensureRuntimeStaged — stale-cache invalidation', () => {
    test('stages files on first call', () => {
        const hash = ensureRuntimeStaged({ runtimePath: runtimeFile, storeDir });
        const paths = getBundleStorePaths(hash, storeDir);
        expect(existsSync(paths.iosBundlePath)).toBe(true);
        expect(existsSync(paths.manifestFieldsPath)).toBe(true);
        expect(existsSync(paths.metaPath)).toBe(true);
    });

    test('reuses the cached hash when on-disk files are intact', () => {
        const h1 = ensureRuntimeStaged({ runtimePath: runtimeFile, storeDir });
        const h2 = ensureRuntimeStaged({ runtimePath: runtimeFile, storeDir });
        expect(h2).toBe(h1);
    });

    test('re-stages when the on-disk directory has been wiped (macOS tmpwatch)', () => {
        const h1 = ensureRuntimeStaged({ runtimePath: runtimeFile, storeDir });
        const paths = getBundleStorePaths(h1, storeDir);

        // Simulate launchd tmpwatch: wipe the bundle dir contents but
        // leave the parent directory in place so the server's cached
        // hash points at an empty directory.
        rmSync(paths.iosBundlePath);
        rmSync(paths.androidBundlePath);
        rmSync(paths.manifestFieldsPath);
        rmSync(paths.metaPath);
        expect(existsSync(paths.manifestFieldsPath)).toBe(false);

        // Second call must notice the cache is a lie and re-stage.
        const h2 = ensureRuntimeStaged({ runtimePath: runtimeFile, storeDir });

        // Same source => same hash.
        expect(h2).toBe(h1);
        // But the on-disk files are back.
        expect(existsSync(paths.iosBundlePath)).toBe(true);
        expect(existsSync(paths.manifestFieldsPath)).toBe(true);
    });
});

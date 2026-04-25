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

import { mkdtempSync, rmSync, statSync, utimesSync, writeFileSync, existsSync } from 'node:fs';
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

    test('re-stages when the per-hash directory itself is gone', () => {
        // Stronger form of the previous test — simulates a wider tmpwatch
        // run that removes the HASH dir entirely, not just its contents.
        // mkdirSync { recursive: true } inside ensureRuntimeStaged must
        // recreate the directory before writing.
        const h1 = ensureRuntimeStaged({ runtimePath: runtimeFile, storeDir });
        const paths = getBundleStorePaths(h1, storeDir);
        rmSync(paths.dir, { recursive: true, force: true });
        expect(existsSync(paths.dir)).toBe(false);

        const h2 = ensureRuntimeStaged({ runtimePath: runtimeFile, storeDir });
        expect(h2).toBe(h1);
        expect(existsSync(paths.iosBundlePath)).toBe(true);
        expect(existsSync(paths.manifestFieldsPath)).toBe(true);
    });

    test('first re-stage keeps the cached hash, not throws, even if only a subset is missing', () => {
        // Partial-wipe scenario: only manifest-fields.json is gone. The
        // existsSync guard checks iosBundlePath AND manifestFieldsPath, so
        // missing EITHER should trigger a re-stage. Locks in that the
        // guard is a logical AND (both must be present to reuse cache).
        const h1 = ensureRuntimeStaged({ runtimePath: runtimeFile, storeDir });
        const paths = getBundleStorePaths(h1, storeDir);
        rmSync(paths.manifestFieldsPath);
        expect(existsSync(paths.iosBundlePath)).toBe(true);
        expect(existsSync(paths.manifestFieldsPath)).toBe(false);

        const h2 = ensureRuntimeStaged({ runtimePath: runtimeFile, storeDir });
        expect(h2).toBe(h1);
        expect(existsSync(paths.manifestFieldsPath)).toBe(true);
    });

    test('re-stages when the source bundle has been rebuilt (mtime drift)', () => {
        // Long-running server scenario: the editor process keeps
        // mobile-preview alive across days; meanwhile a developer pulls a
        // fix (e.g. PR #20's runtime.js gate fix) and rebuilds bundle.js.
        // The hash dir from the OLD bundle still exists, so the
        // existsSync guards alone would happily return the stale hash and
        // every manifest URL would point at the OLD bundle's hash dir.
        // mtime drift detection forces a re-stage so Expo Go fetches the
        // freshly-built runtime instead.
        const h1 = ensureRuntimeStaged({ runtimePath: runtimeFile, storeDir });

        // Rewrite the source bundle with new content + bump mtime forward
        // by 5 seconds to mimic a rebuild (some filesystems have 1s mtime
        // resolution, so write-then-utimes is more reliable than relying
        // on writeFileSync alone to update mtime).
        writeFileSync(runtimeFile, '// test-runtime-v2 — entry.js fix\n');
        const before = statSync(runtimeFile);
        const futureSeconds = before.mtimeMs / 1000 + 5;
        utimesSync(runtimeFile, futureSeconds, futureSeconds);

        const h2 = ensureRuntimeStaged({ runtimePath: runtimeFile, storeDir });
        // Different bundle content => different hash.
        expect(h2).not.toBe(h1);
        // New hash dir is populated, old one stays put (caller doesn't
        // own cleanup of stale hash dirs — that's tmpwatch's job).
        const newPaths = getBundleStorePaths(h2, storeDir);
        expect(existsSync(newPaths.iosBundlePath)).toBe(true);
        expect(existsSync(newPaths.manifestFieldsPath)).toBe(true);
    });
});

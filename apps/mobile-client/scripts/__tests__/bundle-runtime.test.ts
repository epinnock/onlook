import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { ONLOOK_RUNTIME_VERSION } from '@onlook/mobile-client-protocol';
import { bundleRuntime, parseArgs, sha256, type RuntimeMeta } from '../bundle-runtime.ts';

let tmpRoot: string;
let sourcePath: string;
let iosDest: string;
let androidDest: string;

const FIXTURE_BUNDLE = '(function() { /* mock onlook runtime */ })();';

beforeEach(() => {
    tmpRoot = mkdtempSync(join(tmpdir(), 'bundle-runtime-test-'));
    sourcePath = join(tmpRoot, 'source', 'bundle.js');
    iosDest = join(tmpRoot, 'ios', 'Resources', 'onlook-runtime.js');
    androidDest = join(tmpRoot, 'android', 'assets', 'onlook-runtime.js');
    // Seed a fake source bundle
    const { mkdirSync } = require('node:fs') as typeof import('node:fs');
    mkdirSync(join(tmpRoot, 'source'), { recursive: true });
    writeFileSync(sourcePath, FIXTURE_BUNDLE);
});

afterEach(() => {
    rmSync(tmpRoot, { recursive: true, force: true });
});

describe('sha256 helper', () => {
    test('produces a 64-char lowercase hex digest', () => {
        const hash = sha256(Buffer.from('hello'));
        expect(hash).toMatch(/^[0-9a-f]{64}$/);
    });

    test('is deterministic', () => {
        expect(sha256(Buffer.from('x'))).toBe(sha256(Buffer.from('x')));
    });
});

describe('parseArgs', () => {
    const base = {
        dryRun: false,
        skipMissing: false,
        sourcePath: '/default/src',
        iosDest: '/default/ios',
        androidDest: '/default/android',
    };

    test('defaults are preserved when argv is empty', () => {
        expect(parseArgs([], base)).toEqual(base);
    });

    test('parses --dry-run', () => {
        expect(parseArgs(['--dry-run'], base).dryRun).toBe(true);
    });

    test('parses --skip-missing', () => {
        expect(parseArgs(['--skip-missing'], base).skipMissing).toBe(true);
    });

    test('parses --dest-ios= and --dest-android=', () => {
        const result = parseArgs(
            ['--dest-ios=/override/ios.js', '--dest-android=/override/android.js'],
            base,
        );
        expect(result.iosDest).toBe('/override/ios.js');
        expect(result.androidDest).toBe('/override/android.js');
    });

    test('parses --source=', () => {
        const result = parseArgs(['--source=/override/src.js'], base);
        expect(result.sourcePath).toBe('/override/src.js');
    });
});

describe('bundleRuntime end-to-end (temp dir)', () => {
    test('copies the fixture bundle to both destinations', () => {
        const results = bundleRuntime({
            dryRun: false,
            skipMissing: false,
            sourcePath,
            iosDest,
            androidDest,
        });
        expect(results).toHaveLength(2);
        for (const r of results) {
            expect(r.skipped).toBe(false);
            expect(r.bytes).toBe(FIXTURE_BUNDLE.length);
        }
        const iosCopied = readFileSync(iosDest, 'utf8');
        const androidCopied = readFileSync(androidDest, 'utf8');
        expect(iosCopied).toBe(FIXTURE_BUNDLE);
        expect(androidCopied).toBe(FIXTURE_BUNDLE);
    });

    test('writes sibling meta.json with correct version + sha256', () => {
        bundleRuntime({
            dryRun: false,
            skipMissing: false,
            sourcePath,
            iosDest,
            androidDest,
        });
        const metaPath = iosDest.replace(/\.js$/, '.meta.json');
        const meta = JSON.parse(readFileSync(metaPath, 'utf8')) as RuntimeMeta;
        expect(meta.version).toBe(ONLOOK_RUNTIME_VERSION);
        expect(meta.sha256).toBe(sha256(Buffer.from(FIXTURE_BUNDLE)));
        expect(meta.bytes).toBe(FIXTURE_BUNDLE.length);
        expect(meta.copiedFrom).toBe(sourcePath);
        expect(() => new Date(meta.copiedAt).toISOString()).not.toThrow();
    });

    test('throws on missing source bundle', () => {
        expect(() =>
            bundleRuntime({
                dryRun: false,
                skipMissing: false,
                sourcePath: '/nonexistent/path/bundle.js',
                iosDest,
                androidDest,
            }),
        ).toThrow(/source bundle not found/);
    });

    test('throws on empty source bundle', () => {
        writeFileSync(sourcePath, '');
        expect(() =>
            bundleRuntime({
                dryRun: false,
                skipMissing: false,
                sourcePath,
                iosDest,
                androidDest,
            }),
        ).toThrow(/empty/);
    });

    test('dry-run does not write destination files', () => {
        const results = bundleRuntime({
            dryRun: true,
            skipMissing: false,
            sourcePath,
            iosDest,
            androidDest,
        });
        expect(results[0]?.bytes).toBe(FIXTURE_BUNDLE.length);
        const { existsSync } = require('node:fs') as typeof import('node:fs');
        expect(existsSync(iosDest)).toBe(false);
        expect(existsSync(androidDest)).toBe(false);
    });

    test('skip-missing skips destinations whose parent directory does not exist', () => {
        const results = bundleRuntime({
            dryRun: false,
            skipMissing: true,
            sourcePath,
            iosDest: join(tmpRoot, 'never-created-ios', 'x', 'rt.js'),
            androidDest: join(tmpRoot, 'never-created-android', 'y', 'rt.js'),
        });
        expect(results[0]?.skipped).toBe(true);
        expect(results[0]?.skipReason).toMatch(/parent directory missing/);
        expect(results[1]?.skipped).toBe(true);
    });
});

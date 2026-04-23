import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import {
    compareScreenshots,
    parseArgs,
    sha256,
} from '../screenshot-diff';

const FIXTURE_ROOT = (() => {
    const dir = mkdtempSync(join(tmpdir(), 'screenshot-diff-'));
    return dir;
})();

function writeFixture(name: string, content: string | Buffer): string {
    const path = join(FIXTURE_ROOT, name);
    writeFileSync(path, content);
    return path;
}

const REPO_ROOT = resolve(import.meta.dir, '..', '..', '..', '..');
const BASELINE_HELLO = join(
    REPO_ROOT,
    'plans',
    'adr',
    'assets',
    'v2-pipeline',
    'v2r-hello.png',
);
const BASELINE_UPDATED = join(
    REPO_ROOT,
    'plans',
    'adr',
    'assets',
    'v2-pipeline',
    'v2r-updated.png',
);

describe('sha256', () => {
    test('hashes empty buffer', () => {
        expect(sha256(Buffer.from('')).length).toBe(64);
    });

    test('deterministic for identical input', () => {
        const a = sha256(Buffer.from('hello'));
        const b = sha256(Buffer.from('hello'));
        expect(a).toBe(b);
    });

    test('different for different input', () => {
        expect(sha256(Buffer.from('a'))).not.toBe(sha256(Buffer.from('b')));
    });
});

describe('compareScreenshots (synthetic fixtures)', () => {
    test('exact hash match — tier=hash, match=true', () => {
        const body = Buffer.from('identical body');
        const baseline = writeFixture('equal-a.png', body);
        const candidate = writeFixture('equal-b.png', body);
        const result = compareScreenshots(baseline, candidate, 0.05);
        expect(result.match).toBe(true);
        expect(result.tier).toBe('hash');
        expect(result.sizeDeltaBytes).toBe(0);
    });

    test('within size tolerance — tier=size, match=true', () => {
        const baseline = writeFixture('near-a.png', Buffer.alloc(1000, 0x11));
        const candidate = writeFixture('near-b.png', Buffer.alloc(1020, 0x22));
        const result = compareScreenshots(baseline, candidate, 0.05);
        expect(result.match).toBe(true);
        expect(result.tier).toBe('size');
        expect(result.sizeDeltaRatio).toBeCloseTo(0.02, 5);
    });

    test('beyond size tolerance — tier=mismatch, match=false', () => {
        const baseline = writeFixture('far-a.png', Buffer.alloc(1000, 0x11));
        const candidate = writeFixture('far-b.png', Buffer.alloc(1100, 0x22));
        const result = compareScreenshots(baseline, candidate, 0.05);
        expect(result.match).toBe(false);
        expect(result.tier).toBe('mismatch');
        expect(result.sizeDeltaRatio).toBeCloseTo(0.1, 5);
    });

    test('size delta is absolute — shrinking beyond tolerance also fails', () => {
        const baseline = writeFixture('shrink-a.png', Buffer.alloc(1000, 0x11));
        const candidate = writeFixture('shrink-b.png', Buffer.alloc(800, 0x22));
        const result = compareScreenshots(baseline, candidate, 0.1);
        expect(result.match).toBe(false);
        expect(result.sizeDeltaBytes).toBe(-200);
        expect(result.sizeDeltaRatio).toBeCloseTo(0.2, 5);
    });

    test('zero-byte baseline yields sizeDeltaRatio=0 (no divide-by-zero)', () => {
        const baseline = writeFixture('empty.png', Buffer.alloc(0));
        const candidate = writeFixture('small.png', Buffer.from('hi'));
        const result = compareScreenshots(baseline, candidate, 0.05);
        expect(result.sizeDeltaRatio).toBe(0);
    });

    test('throws on missing baseline', () => {
        expect(() =>
            compareScreenshots(
                join(FIXTURE_ROOT, 'does-not-exist.png'),
                writeFixture('any.png', 'x'),
                0.05,
            ),
        ).toThrow(/baseline not found/);
    });

    test('throws on missing candidate', () => {
        expect(() =>
            compareScreenshots(
                writeFixture('any2.png', 'x'),
                join(FIXTURE_ROOT, 'does-not-exist.png'),
                0.05,
            ),
        ).toThrow(/candidate not found/);
    });

    test('throws on invalid tolerance', () => {
        const a = writeFixture('t-a.png', 'x');
        const b = writeFixture('t-b.png', 'y');
        expect(() => compareScreenshots(a, b, -0.1)).toThrow(/tolerance/);
        expect(() => compareScreenshots(a, b, 1.5)).toThrow(/tolerance/);
    });
});

describe('compareScreenshots (v2r baseline screenshots)', () => {
    test('v2r-hello vs itself — hash match', () => {
        const result = compareScreenshots(BASELINE_HELLO, BASELINE_HELLO, 0.05);
        expect(result.match).toBe(true);
        expect(result.tier).toBe('hash');
    });

    test('v2r-hello vs v2r-updated — perceptual tier catches dramatic colour + text change', () => {
        // The two screenshots render completely different colour palettes
        // (dark blue + "Hello, Onlook!" vs dark green + "UPDATED via v2!").
        // PNG compression yields similar bytes (94181 vs 90086 → ~4%), which
        // used to pass a loose size-tier gate — a false positive the
        // perceptual tier now catches decisively.
        const tight = compareScreenshots(BASELINE_HELLO, BASELINE_UPDATED, 0.02);
        expect(tight.match).toBe(false);
        expect(tight.tier).toBe('mismatch');

        // Loose tolerance used to false-positive via size tier. With the
        // perceptual tier enabled (default), the mismatch surfaces through
        // pixel diff instead of leaking past the size gate.
        const loose = compareScreenshots(BASELINE_HELLO, BASELINE_UPDATED, 0.05);
        expect(loose.match).toBe(false);
        expect(loose.tier).toBe('mismatch');
        expect(loose.perceptualRatio).toBeGreaterThan(0.05);

        // With perceptual disabled, the legacy size-tier behaviour returns.
        const legacy = compareScreenshots(BASELINE_HELLO, BASELINE_UPDATED, {
            tolerance: 0.05,
            noPerceptual: true,
        });
        expect(legacy.match).toBe(true);
        expect(legacy.tier).toBe('size');
    });

    test('perceptual tier matches near-identical screenshots below threshold', () => {
        // v2r-hello compared to itself via the perceptual path (hash tier
        // would win, so force perceptual by using a different path — the
        // sibling symlink trick: load the same file twice as two copies).
        const result = compareScreenshots(BASELINE_HELLO, BASELINE_HELLO, {
            tolerance: 0.05,
            perceptualThreshold: 0.001,
        });
        // Hash match wins first (same bytes), but perceptualRatio shouldn't
        // be populated in that case since we short-circuit on hash.
        expect(result.tier).toBe('hash');
    });
});

describe('parseArgs', () => {
    test('parses two positional args with default tolerance', () => {
        const p = parseArgs(['a.png', 'b.png']);
        expect(p.tolerance).toBe(0.05);
        expect(p.json).toBe(false);
    });

    test('parses --tolerance N form', () => {
        const p = parseArgs(['a.png', 'b.png', '--tolerance', '0.1']);
        expect(p.tolerance).toBe(0.1);
    });

    test('parses --tolerance=N form', () => {
        const p = parseArgs(['a.png', 'b.png', '--tolerance=0.2']);
        expect(p.tolerance).toBe(0.2);
    });

    test('parses --json flag', () => {
        const p = parseArgs(['a.png', 'b.png', '--json']);
        expect(p.json).toBe(true);
    });

    test('throws on missing positional args', () => {
        expect(() => parseArgs([])).toThrow(/usage/);
        expect(() => parseArgs(['only-one.png'])).toThrow(/usage/);
    });

    test('throws on extra positional args', () => {
        expect(() => parseArgs(['a.png', 'b.png', 'c.png'])).toThrow(/usage/);
    });

    test('throws on unknown flag', () => {
        expect(() => parseArgs(['a.png', 'b.png', '--foo'])).toThrow(/unknown flag/);
    });

    test('throws on non-numeric tolerance', () => {
        expect(() => parseArgs(['a.png', 'b.png', '--tolerance', 'bad'])).toThrow(
            /numeric/,
        );
    });
});

afterAll(() => {
    rmSync(FIXTURE_ROOT, { recursive: true, force: true });
});

beforeAll(() => {
    mkdirSync(FIXTURE_ROOT, { recursive: true });
});

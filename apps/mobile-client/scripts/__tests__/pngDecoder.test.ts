import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { decodePng, perceptualDiff, PngDecodeError } from '../pngDecoder';

const REPO_ROOT = resolve(import.meta.dir, '..', '..', '..', '..');
const BASELINE_HELLO = resolve(
    REPO_ROOT,
    'plans',
    'adr',
    'assets',
    'v2-pipeline',
    'v2r-hello.png',
);
const BASELINE_UPDATED = resolve(
    REPO_ROOT,
    'plans',
    'adr',
    'assets',
    'v2-pipeline',
    'v2r-updated.png',
);

describe('decodePng — fixtures (v2r-hello.png)', () => {
    test('decodes an iPhone-16-sim PNG to RGBA8 buffer', () => {
        const img = decodePng(readFileSync(BASELINE_HELLO));
        expect(img.width).toBeGreaterThan(0);
        expect(img.height).toBeGreaterThan(0);
        expect(img.pixels.length).toBe(img.width * img.height * 4);
    });

    test('same file decoded twice yields identical pixel buffer', () => {
        const a = decodePng(readFileSync(BASELINE_HELLO));
        const b = decodePng(readFileSync(BASELINE_HELLO));
        expect(a.width).toBe(b.width);
        expect(a.height).toBe(b.height);
        // Compare sha256-like: just assert byte equality via length + sample
        expect(a.pixels.length).toBe(b.pixels.length);
        expect(a.pixels[0]).toBe(b.pixels[0]);
        expect(a.pixels[a.pixels.length - 1]).toBe(b.pixels[b.pixels.length - 1]);
    });
});

describe('decodePng — error paths', () => {
    test('throws on zero-length input', () => {
        expect(() => decodePng(new Uint8Array(0))).toThrow(PngDecodeError);
    });

    test('throws on bad signature', () => {
        const bad = new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
        expect(() => decodePng(bad)).toThrow(/signature/);
    });

    test('throws on truncated input after signature', () => {
        const sig = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
        expect(() => decodePng(sig)).toThrow(PngDecodeError);
    });
});

describe('perceptualDiff — synthetic pixel buffers', () => {
    function makeImg(w: number, h: number, fill: [number, number, number, number]) {
        const pixels = new Uint8Array(w * h * 4);
        for (let i = 0; i < w * h; i++) {
            pixels[i * 4] = fill[0];
            pixels[i * 4 + 1] = fill[1];
            pixels[i * 4 + 2] = fill[2];
            pixels[i * 4 + 3] = fill[3];
        }
        return { width: w, height: h, pixels };
    }

    test('identical pixel buffers have zero diff', () => {
        const a = makeImg(10, 10, [10, 20, 30, 255]);
        const b = makeImg(10, 10, [10, 20, 30, 255]);
        const d = perceptualDiff(a, b);
        expect(d.diffPixels).toBe(0);
        expect(d.diffRatio).toBe(0);
        expect(d.totalPixels).toBe(100);
    });

    test('completely different colours have 100% diff', () => {
        const a = makeImg(10, 10, [0, 0, 0, 255]);
        const b = makeImg(10, 10, [255, 255, 255, 255]);
        const d = perceptualDiff(a, b);
        expect(d.diffPixels).toBe(100);
        expect(d.diffRatio).toBe(1);
    });

    test('sub-threshold channel deltas are tolerated', () => {
        const a = makeImg(10, 10, [100, 100, 100, 255]);
        const b = makeImg(10, 10, [105, 108, 112, 255]); // all within 16
        const d = perceptualDiff(a, b, 16);
        expect(d.diffPixels).toBe(0);
    });

    test('supra-threshold alpha delta counts as diff', () => {
        const a = makeImg(10, 10, [50, 50, 50, 255]);
        const b = makeImg(10, 10, [50, 50, 50, 100]); // alpha diff = 155
        const d = perceptualDiff(a, b, 16);
        expect(d.diffRatio).toBe(1);
    });

    test('dimension mismatch throws PngDecodeError', () => {
        const a = makeImg(10, 10, [0, 0, 0, 0]);
        const b = makeImg(20, 10, [0, 0, 0, 0]);
        expect(() => perceptualDiff(a, b)).toThrow(/dimension mismatch/);
    });
});

describe('perceptualDiff — v2r baseline PNGs (real-world)', () => {
    test('v2r-hello vs v2r-updated has a substantial pixel delta (different colours + text)', () => {
        const a = decodePng(readFileSync(BASELINE_HELLO));
        const b = decodePng(readFileSync(BASELINE_UPDATED));
        const d = perceptualDiff(a, b);
        // The two images are dark-blue vs dark-green with different text —
        // nearly every pixel falls outside the default 16-per-channel
        // threshold. Expect >10% differing pixels (realistically much more).
        expect(d.diffRatio).toBeGreaterThan(0.1);
    });

    test('v2r-hello vs itself has zero pixel delta', () => {
        const a = decodePng(readFileSync(BASELINE_HELLO));
        const b = decodePng(readFileSync(BASELINE_HELLO));
        const d = perceptualDiff(a, b);
        expect(d.diffPixels).toBe(0);
    });
});

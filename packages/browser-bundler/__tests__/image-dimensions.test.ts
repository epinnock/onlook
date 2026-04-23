import { describe, expect, test } from 'bun:test';

import { extractImageDimensions } from '../src/image-dimensions';

// ─── Fixture helpers — synthesize minimal valid headers ──────────────────────

function pngHeader(width: number, height: number): Uint8Array {
    // 8-byte signature + 13-byte IHDR (length=13, type='IHDR', width, height,
    // depth=8, color=2, compression=0, filter=0, interlace=0) + dummy CRC.
    const bytes = new Uint8Array(8 + 4 + 4 + 13 + 4);
    bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
    const dv = new DataView(bytes.buffer);
    dv.setUint32(8, 13, false); // IHDR length
    bytes.set([0x49, 0x48, 0x44, 0x52], 12); // 'IHDR'
    dv.setUint32(16, width, false);
    dv.setUint32(20, height, false);
    return bytes;
}

function gifHeader(width: number, height: number, version: '87a' | '89a' = '89a'): Uint8Array {
    // 6-byte signature + 2-byte width LE + 2-byte height LE + dummy 4 bytes
    const bytes = new Uint8Array(13);
    bytes.set([0x47, 0x49, 0x46, 0x38, version === '89a' ? 0x39 : 0x37, 0x61], 0);
    new DataView(bytes.buffer).setUint16(6, width, true);
    new DataView(bytes.buffer).setUint16(8, height, true);
    return bytes;
}

function webpVp8Header(width: number, height: number): Uint8Array {
    const bytes = new Uint8Array(40);
    bytes.set([0x52, 0x49, 0x46, 0x46], 0); // 'RIFF'
    new DataView(bytes.buffer).setUint32(4, 32, true); // file size minus 8
    bytes.set([0x57, 0x45, 0x42, 0x50], 8); // 'WEBP'
    bytes.set([0x56, 0x50, 0x38, 0x20], 12); // 'VP8 '
    new DataView(bytes.buffer).setUint16(26, width & 0x3fff, true);
    new DataView(bytes.buffer).setUint16(28, height & 0x3fff, true);
    return bytes;
}

function webpVp8xHeader(width: number, height: number): Uint8Array {
    const bytes = new Uint8Array(40);
    bytes.set([0x52, 0x49, 0x46, 0x46], 0); // 'RIFF'
    bytes.set([0x57, 0x45, 0x42, 0x50], 8); // 'WEBP'
    bytes.set([0x56, 0x50, 0x38, 0x58], 12); // 'VP8X'
    // VP8X writes (width-1) at 24-26 and (height-1) at 27-29 as 3-byte LE.
    const w1 = width - 1;
    const h1 = height - 1;
    bytes[24] = w1 & 0xff;
    bytes[25] = (w1 >> 8) & 0xff;
    bytes[26] = (w1 >> 16) & 0xff;
    bytes[27] = h1 & 0xff;
    bytes[28] = (h1 >> 8) & 0xff;
    bytes[29] = (h1 >> 16) & 0xff;
    return bytes;
}

function bmpHeader(width: number, height: number): Uint8Array {
    const bytes = new Uint8Array(54);
    bytes.set([0x42, 0x4d], 0); // 'BM'
    new DataView(bytes.buffer).setInt32(18, width, true);
    new DataView(bytes.buffer).setInt32(22, height, true);
    return bytes;
}

function jpegHeader(width: number, height: number): Uint8Array {
    // SOI + APP0 stub + SOF0 with dimensions + EOI.
    // SOF0 layout: 0xFFC0, length (BE), precision (1), height (BE), width (BE),
    //              numComponents (1)…
    const sofLen = 2 + 1 + 2 + 2 + 1; // length, precision, h, w, components
    const bytes = new Uint8Array(2 + 2 + sofLen + 2);
    let off = 0;
    bytes[off++] = 0xff;
    bytes[off++] = 0xd8; // SOI
    bytes[off++] = 0xff;
    bytes[off++] = 0xc0; // SOF0
    const dv = new DataView(bytes.buffer);
    dv.setUint16(off, sofLen, false);
    off += 2;
    bytes[off++] = 8; // precision
    dv.setUint16(off, height, false);
    off += 2;
    dv.setUint16(off, width, false);
    off += 2;
    bytes[off++] = 1; // numComponents (dummy)
    bytes[off++] = 0xff;
    bytes[off++] = 0xd9; // EOI
    return bytes;
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('extractImageDimensions — PNG', () => {
    test('reads width + height from the IHDR chunk', () => {
        expect(extractImageDimensions(pngHeader(64, 32))).toEqual({ width: 64, height: 32 });
    });

    test('handles square images', () => {
        expect(extractImageDimensions(pngHeader(1, 1))).toEqual({ width: 1, height: 1 });
        expect(extractImageDimensions(pngHeader(2048, 2048))).toEqual({ width: 2048, height: 2048 });
    });

    test('returns undefined for malformed PNG (wrong chunk type)', () => {
        const bytes = pngHeader(10, 10);
        bytes[12] = 0x00; // corrupt 'I' of 'IHDR'
        expect(extractImageDimensions(bytes)).toBeUndefined();
    });

    test('returns undefined for truncated PNG', () => {
        const bytes = pngHeader(10, 10).slice(0, 16);
        expect(extractImageDimensions(bytes)).toBeUndefined();
    });
});

describe('extractImageDimensions — GIF', () => {
    test('reads dimensions from GIF89a logical screen descriptor', () => {
        expect(extractImageDimensions(gifHeader(800, 600, '89a'))).toEqual({
            width: 800,
            height: 600,
        });
    });

    test('reads dimensions from GIF87a header', () => {
        expect(extractImageDimensions(gifHeader(100, 50, '87a'))).toEqual({
            width: 100,
            height: 50,
        });
    });

    test('returns undefined for GIF with unsupported subversion', () => {
        const bytes = gifHeader(10, 10);
        bytes[4] = 0x35; // bogus version digit
        expect(extractImageDimensions(bytes)).toBeUndefined();
    });
});

describe('extractImageDimensions — WebP', () => {
    test('VP8 lossy: reads 14-bit width/height', () => {
        expect(extractImageDimensions(webpVp8Header(640, 480))).toEqual({
            width: 640,
            height: 480,
        });
    });

    test('VP8X extended: reads 24-bit width-1/height-1 fields', () => {
        expect(extractImageDimensions(webpVp8xHeader(2000, 1500))).toEqual({
            width: 2000,
            height: 1500,
        });
    });

    test('returns undefined for RIFF without WEBP fourcc', () => {
        const bytes = webpVp8Header(10, 10);
        bytes[8] = 0x00; // corrupt 'W' of 'WEBP'
        expect(extractImageDimensions(bytes)).toBeUndefined();
    });
});

describe('extractImageDimensions — BMP', () => {
    test('reads BITMAPINFOHEADER width/height', () => {
        expect(extractImageDimensions(bmpHeader(1920, 1080))).toEqual({
            width: 1920,
            height: 1080,
        });
    });

    test('takes absolute value of negative height (top-down BMP)', () => {
        const bytes = bmpHeader(100, 100);
        new DataView(bytes.buffer).setInt32(22, -100, true);
        expect(extractImageDimensions(bytes)).toEqual({ width: 100, height: 100 });
    });
});

describe('extractImageDimensions — JPEG', () => {
    test('reads SOF0 frame dimensions', () => {
        expect(extractImageDimensions(jpegHeader(800, 600))).toEqual({
            width: 800,
            height: 600,
        });
    });

    test('handles small images', () => {
        expect(extractImageDimensions(jpegHeader(1, 1))).toEqual({ width: 1, height: 1 });
    });

    test('returns undefined for non-JPEG bytes', () => {
        expect(extractImageDimensions(new Uint8Array([0x00, 0x00, 0x00, 0x00]))).toBeUndefined();
    });
});

describe('extractImageDimensions — unrecognised inputs', () => {
    test('returns undefined for empty bytes', () => {
        expect(extractImageDimensions(new Uint8Array(0))).toBeUndefined();
    });

    test('returns undefined for bytes too short for any signature', () => {
        expect(extractImageDimensions(new Uint8Array([1, 2, 3]))).toBeUndefined();
    });

    test('returns undefined for SVG (text-based, no fixed binary header)', () => {
        const svg = new TextEncoder().encode('<svg viewBox="0 0 10 10"/>');
        expect(extractImageDimensions(svg)).toBeUndefined();
    });

    test('returns undefined for arbitrary binary data', () => {
        const bytes = new Uint8Array(100);
        for (let i = 0; i < bytes.length; i++) bytes[i] = (i * 37) & 0xff;
        expect(extractImageDimensions(bytes)).toBeUndefined();
    });
});

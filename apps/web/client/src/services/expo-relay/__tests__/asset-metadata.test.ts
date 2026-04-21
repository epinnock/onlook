import { describe, expect, test } from 'bun:test';

import { extractAssetMetadata } from '../asset-metadata';

/** Compose a minimal PNG header with the requested IHDR dimensions. */
function pngBytes(width: number, height: number): Uint8Array {
    const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
    const ihdrLength = [0x00, 0x00, 0x00, 0x0d];
    const ihdrType = [0x49, 0x48, 0x44, 0x52];
    const widthBytes = [
        (width >>> 24) & 0xff,
        (width >>> 16) & 0xff,
        (width >>> 8) & 0xff,
        width & 0xff,
    ];
    const heightBytes = [
        (height >>> 24) & 0xff,
        (height >>> 16) & 0xff,
        (height >>> 8) & 0xff,
        height & 0xff,
    ];
    const rest = [0x08, 0x06, 0x00, 0x00, 0x00]; // depth/colorType/compr/filter/interlace
    return new Uint8Array([
        ...signature,
        ...ihdrLength,
        ...ihdrType,
        ...widthBytes,
        ...heightBytes,
        ...rest,
    ]);
}

describe('asset-metadata / extractAssetMetadata', () => {
    test('PNG returns kind:image with width/height from IHDR', () => {
        const meta = extractAssetMetadata(pngBytes(128, 64), 'logo.png');
        expect(meta).toEqual({
            kind: 'image',
            mime: 'image/png',
            width: 128,
            height: 64,
        });
    });

    test('PNG with @2x scale suffix in filename', () => {
        const meta = extractAssetMetadata(pngBytes(256, 128), 'logo@2x.png');
        expect(meta.kind).toBe('image');
        if (meta.kind !== 'image') return;
        expect(meta.scale).toBe(2);
    });

    test('SVG returns kind:svg with viewBox', () => {
        const xml = '<svg viewBox="0 0 100 200" xmlns="http://www.w3.org/2000/svg"></svg>';
        const bytes = new TextEncoder().encode(xml);
        const meta = extractAssetMetadata(bytes, 'icon.svg');
        expect(meta).toEqual({
            kind: 'svg',
            mime: 'image/svg+xml',
            viewBox: '0 0 100 200',
        });
    });

    test('SVG without viewBox omits the field', () => {
        const xml = '<svg xmlns="http://www.w3.org/2000/svg"></svg>';
        const meta = extractAssetMetadata(new TextEncoder().encode(xml), 'x.svg');
        expect(meta.kind).toBe('svg');
        if (meta.kind !== 'svg') return;
        expect(meta.viewBox).toBeUndefined();
    });

    test('TTF font returns family from filename', () => {
        const meta = extractAssetMetadata(new Uint8Array([0]), 'Inter-Bold.ttf');
        expect(meta).toEqual({
            kind: 'font',
            mime: 'font/ttf',
            family: 'Inter',
        });
    });

    test('OTF font recognises family with subfolder', () => {
        const meta = extractAssetMetadata(new Uint8Array([0]), 'fonts/Roboto-Regular.otf');
        expect(meta.kind).toBe('font');
        if (meta.kind !== 'font') return;
        expect(meta.family).toBe('Roboto');
    });

    test('mp3 falls into kind:media', () => {
        const meta = extractAssetMetadata(new Uint8Array([0]), 'ping.mp3');
        expect(meta).toEqual({ kind: 'media', mime: 'audio/mpeg' });
    });

    test('mp4 falls into kind:media', () => {
        const meta = extractAssetMetadata(new Uint8Array([0]), 'clip.mp4');
        expect(meta).toEqual({ kind: 'media', mime: 'video/mp4' });
    });

    test('unknown extension falls into kind:binary', () => {
        const meta = extractAssetMetadata(new Uint8Array([0]), 'data.dat');
        expect(meta).toEqual({ kind: 'binary', mime: 'application/octet-stream' });
    });

    test('PNG with truncated bytes returns image kind but no dimensions', () => {
        const meta = extractAssetMetadata(new Uint8Array([0x89, 0x50]), 'tiny.png');
        expect(meta.kind).toBe('image');
        if (meta.kind !== 'image') return;
        expect(meta.width).toBeUndefined();
        expect(meta.height).toBeUndefined();
    });

    test('JPEG SOF0 marker returns width/height', () => {
        // Construct a minimal JPEG with FF D8, then an SOF0 at FF C0.
        const data = new Uint8Array([
            0xff, 0xd8, // SOI
            0xff, 0xc0, // SOF0
            0x00, 0x11, // segLen=17 (not used by parser past the 9 bytes we read)
            0x08,       // precision
            0x01, 0x2c, // height = 300 big-endian
            0x02, 0x58, // width = 600 big-endian
            // rest padded
            0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        ]);
        const meta = extractAssetMetadata(data, 'photo.jpg');
        expect(meta.kind).toBe('image');
        if (meta.kind !== 'image') return;
        expect(meta.width).toBe(600);
        expect(meta.height).toBe(300);
    });
});

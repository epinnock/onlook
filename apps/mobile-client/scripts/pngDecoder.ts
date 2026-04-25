/**
 * pngDecoder.ts — minimal pure-TS PNG decoder scoped to the RGBA8 / RGB8
 * output simctl screenshots produce.
 *
 * No external deps. Uses `node:zlib.inflateSync` for IDAT decompression
 * (Bun exposes the same API). Output is always upcast to RGBA8 so
 * downstream pixel-diff code doesn't need to branch on color type.
 *
 * Supported color types (from the PNG spec):
 *   0 = grayscale 8/16
 *   2 = RGB 8/16
 *   3 = palette (PLTE)
 *   4 = grayscale + alpha 8/16
 *   6 = RGBA 8/16
 *
 * 16-bit samples are truncated to 8 bits for diff purposes (sufficient
 * precision for UI screenshots). Interlacing (Adam7) is NOT supported —
 * simctl doesn't emit interlaced PNGs.
 *
 * Spec reference: https://www.w3.org/TR/PNG/
 */

import { inflateSync } from 'node:zlib';

export type DecodedImage = {
    width: number;
    height: number;
    /** RGBA8 pixel buffer, row-major, length = width * height * 4. */
    pixels: Uint8Array;
};

export class PngDecodeError extends Error {
    constructor(message: string) {
        super(`png-decoder: ${message}`);
        this.name = 'PngDecodeError';
    }
}

const PNG_SIGNATURE = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);

type Ihdr = {
    width: number;
    height: number;
    bitDepth: number;
    colorType: number;
    interlace: number;
};

export function decodePng(data: Uint8Array | Buffer): DecodedImage {
    const buf = data instanceof Uint8Array ? data : new Uint8Array(data);
    if (buf.length < 8) throw new PngDecodeError('input too short for signature');
    for (let i = 0; i < 8; i++) {
        if (buf[i] !== PNG_SIGNATURE[i]) throw new PngDecodeError('bad signature');
    }

    let offset = 8;
    let ihdr: Ihdr | null = null;
    const idatParts: Uint8Array[] = [];
    let palette: Uint8Array | null = null;
    const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);

    while (offset < buf.length) {
        if (offset + 8 > buf.length) {
            throw new PngDecodeError(`truncated chunk header at offset ${offset}`);
        }
        const length = view.getUint32(offset);
        offset += 4;
        const type = String.fromCharCode(
            buf[offset] ?? 0,
            buf[offset + 1] ?? 0,
            buf[offset + 2] ?? 0,
            buf[offset + 3] ?? 0,
        );
        offset += 4;
        const dataStart = offset;
        if (dataStart + length + 4 > buf.length) {
            throw new PngDecodeError(`truncated chunk ${type}`);
        }
        const chunkData = buf.subarray(dataStart, dataStart + length);
        offset = dataStart + length;
        offset += 4; // skip CRC

        if (type === 'IHDR') {
            if (length !== 13) throw new PngDecodeError(`bad IHDR length ${length}`);
            const wView = new DataView(
                chunkData.buffer,
                chunkData.byteOffset,
                chunkData.byteLength,
            );
            ihdr = {
                width: wView.getUint32(0),
                height: wView.getUint32(4),
                bitDepth: chunkData[8] ?? 0,
                colorType: chunkData[9] ?? 0,
                interlace: chunkData[12] ?? 0,
            };
            if (ihdr.interlace !== 0) {
                throw new PngDecodeError('interlaced PNGs not supported');
            }
            if (ihdr.width === 0 || ihdr.height === 0) {
                throw new PngDecodeError('zero-dimension image');
            }
        } else if (type === 'PLTE') {
            palette = new Uint8Array(chunkData);
        } else if (type === 'IDAT') {
            idatParts.push(new Uint8Array(chunkData));
        } else if (type === 'IEND') {
            break;
        }
        // ignore other ancillary chunks (tEXt, gAMA, pHYs, etc.)
    }

    if (!ihdr) throw new PngDecodeError('missing IHDR chunk');
    if (idatParts.length === 0) throw new PngDecodeError('missing IDAT chunk');

    const compressed = concatBuffers(idatParts);
    const raw = new Uint8Array(inflateSync(compressed));

    const channels = channelsFor(ihdr.colorType);
    const bytesPerSample = ihdr.bitDepth === 16 ? 2 : 1;
    const stride = ihdr.width * channels * bytesPerSample;
    const expected = (stride + 1) * ihdr.height;
    if (raw.length !== expected) {
        throw new PngDecodeError(
            `inflated size mismatch (got ${raw.length}, expected ${expected})`,
        );
    }

    const defiltered = defilter(raw, ihdr.width, ihdr.height, channels, bytesPerSample);
    const rgba = toRgba8(defiltered, ihdr, palette);

    return { width: ihdr.width, height: ihdr.height, pixels: rgba };
}

function concatBuffers(parts: Uint8Array[]): Uint8Array {
    let total = 0;
    for (const p of parts) total += p.length;
    const out = new Uint8Array(total);
    let off = 0;
    for (const p of parts) {
        out.set(p, off);
        off += p.length;
    }
    return out;
}

function channelsFor(colorType: number): number {
    switch (colorType) {
        case 0:
            return 1; // grayscale
        case 2:
            return 3; // RGB
        case 3:
            return 1; // palette
        case 4:
            return 2; // grayscale + alpha
        case 6:
            return 4; // RGBA
        default:
            throw new PngDecodeError(`unsupported color type ${colorType}`);
    }
}

function defilter(
    raw: Uint8Array,
    width: number,
    height: number,
    channels: number,
    bytesPerSample: number,
): Uint8Array {
    const stride = width * channels * bytesPerSample;
    const out = new Uint8Array(stride * height);
    const bpp = Math.max(1, channels * bytesPerSample);
    for (let y = 0; y < height; y++) {
        const filter = raw[y * (stride + 1)] ?? 0;
        const inOffset = y * (stride + 1) + 1;
        const outOffset = y * stride;
        for (let x = 0; x < stride; x++) {
            const raw_x = raw[inOffset + x] ?? 0;
            const left = x >= bpp ? (out[outOffset + x - bpp] ?? 0) : 0;
            const up = y > 0 ? (out[outOffset - stride + x] ?? 0) : 0;
            const upLeft = y > 0 && x >= bpp ? (out[outOffset - stride + x - bpp] ?? 0) : 0;
            let v = raw_x;
            switch (filter) {
                case 0:
                    break;
                case 1:
                    v = (raw_x + left) & 0xff;
                    break;
                case 2:
                    v = (raw_x + up) & 0xff;
                    break;
                case 3:
                    v = (raw_x + ((left + up) >> 1)) & 0xff;
                    break;
                case 4:
                    v = (raw_x + paeth(left, up, upLeft)) & 0xff;
                    break;
                default:
                    throw new PngDecodeError(`unknown filter ${filter} at row ${y}`);
            }
            out[outOffset + x] = v;
        }
    }
    return out;
}

function paeth(a: number, b: number, c: number): number {
    const p = a + b - c;
    const pa = Math.abs(p - a);
    const pb = Math.abs(p - b);
    const pc = Math.abs(p - c);
    if (pa <= pb && pa <= pc) return a;
    if (pb <= pc) return b;
    return c;
}

function toRgba8(
    defiltered: Uint8Array,
    ihdr: Ihdr,
    palette: Uint8Array | null,
): Uint8Array {
    const { width, height, bitDepth, colorType } = ihdr;
    const total = width * height;
    const rgba = new Uint8Array(total * 4);
    const bytesPerSample = bitDepth === 16 ? 2 : 1;

    const readSample = (offset: number): number => {
        if (bytesPerSample === 1) return defiltered[offset] ?? 0;
        // Truncate 16-bit high byte for lossy 8-bit output.
        return defiltered[offset] ?? 0;
    };

    const perPixel = channelsFor(colorType) * bytesPerSample;
    for (let i = 0; i < total; i++) {
        const src = i * perPixel;
        const dst = i * 4;
        switch (colorType) {
            case 0: {
                const g = readSample(src);
                rgba[dst] = g;
                rgba[dst + 1] = g;
                rgba[dst + 2] = g;
                rgba[dst + 3] = 255;
                break;
            }
            case 2:
                rgba[dst] = readSample(src);
                rgba[dst + 1] = readSample(src + bytesPerSample);
                rgba[dst + 2] = readSample(src + bytesPerSample * 2);
                rgba[dst + 3] = 255;
                break;
            case 3: {
                if (!palette) throw new PngDecodeError('palette image missing PLTE');
                const idx = (defiltered[src] ?? 0) * 3;
                rgba[dst] = palette[idx] ?? 0;
                rgba[dst + 1] = palette[idx + 1] ?? 0;
                rgba[dst + 2] = palette[idx + 2] ?? 0;
                rgba[dst + 3] = 255;
                break;
            }
            case 4: {
                const g = readSample(src);
                rgba[dst] = g;
                rgba[dst + 1] = g;
                rgba[dst + 2] = g;
                rgba[dst + 3] = readSample(src + bytesPerSample);
                break;
            }
            case 6:
                rgba[dst] = readSample(src);
                rgba[dst + 1] = readSample(src + bytesPerSample);
                rgba[dst + 2] = readSample(src + bytesPerSample * 2);
                rgba[dst + 3] = readSample(src + bytesPerSample * 3);
                break;
            default:
                throw new PngDecodeError(`unsupported color type ${colorType}`);
        }
    }
    return rgba;
}

/**
 * Per-pixel diff over two RGBA8 buffers of matching dimensions.
 * A pixel counts as different when any channel delta exceeds the
 * threshold — 16 out of 255 is a good default for UI screenshots
 * (tolerates sub-pixel anti-aliasing but catches text changes).
 */
export type PerceptualDiff = {
    width: number;
    height: number;
    totalPixels: number;
    diffPixels: number;
    diffRatio: number;
};

export function perceptualDiff(
    a: DecodedImage,
    b: DecodedImage,
    channelThreshold = 16,
): PerceptualDiff {
    if (a.width !== b.width || a.height !== b.height) {
        throw new PngDecodeError(
            `dimension mismatch: ${a.width}x${a.height} vs ${b.width}x${b.height}`,
        );
    }
    const total = a.width * a.height;
    let diff = 0;
    const ap = a.pixels;
    const bp = b.pixels;
    for (let i = 0; i < total; i++) {
        const off = i * 4;
        const dr = Math.abs((ap[off] ?? 0) - (bp[off] ?? 0));
        const dg = Math.abs((ap[off + 1] ?? 0) - (bp[off + 1] ?? 0));
        const db = Math.abs((ap[off + 2] ?? 0) - (bp[off + 2] ?? 0));
        const da = Math.abs((ap[off + 3] ?? 0) - (bp[off + 3] ?? 0));
        if (dr > channelThreshold || dg > channelThreshold || db > channelThreshold || da > channelThreshold) {
            diff += 1;
        }
    }
    return {
        width: a.width,
        height: a.height,
        totalPixels: total,
        diffPixels: diff,
        diffRatio: total === 0 ? 0 : diff / total,
    };
}

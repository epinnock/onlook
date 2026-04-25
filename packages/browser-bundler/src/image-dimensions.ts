/**
 * Pure-JS image-dimension extractor for the asset pipeline (task #63).
 *
 * Reads `width` + `height` from PNG / JPEG / WebP / GIF binary headers
 * without decoding the image. Used by `assets-resolve` to populate
 * `ImageAssetDescriptor.width` / `height` so the runtime can render
 * `<Image>` at the correct intrinsic size before the asset loads.
 *
 * No external deps — works inside Cloudflare Workers, Bun, Node, and
 * the browser. All multi-byte reads use DataView for endianness safety.
 *
 * Returns `undefined` for malformed/unrecognised inputs rather than
 * throwing — the asset descriptor falls back to its width/height fields
 * being absent, which is valid per ABI v1.
 */

export interface ImageDimensions {
    readonly width: number;
    readonly height: number;
}

export function extractImageDimensions(bytes: Uint8Array): ImageDimensions | undefined {
    if (bytes.byteLength < 8) return undefined;

    if (isPng(bytes)) return readPngDimensions(bytes);
    if (isGif(bytes)) return readGifDimensions(bytes);
    if (isWebp(bytes)) return readWebpDimensions(bytes);
    if (isJpeg(bytes)) return readJpegDimensions(bytes);
    if (isBmp(bytes)) return readBmpDimensions(bytes);

    return undefined;
}

// ─── PNG ─────────────────────────────────────────────────────────────────────

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function isPng(bytes: Uint8Array): boolean {
    if (bytes.byteLength < 24) return false;
    for (let i = 0; i < PNG_SIGNATURE.length; i++) {
        if (bytes[i] !== PNG_SIGNATURE[i]) return false;
    }
    return true;
}

function readPngDimensions(bytes: Uint8Array): ImageDimensions | undefined {
    // 8-byte signature, 4-byte chunk length, 4-byte "IHDR" chunk type, then
    // width (4 bytes BE) + height (4 bytes BE).
    if (
        bytes[12] !== 0x49 ||
        bytes[13] !== 0x48 ||
        bytes[14] !== 0x44 ||
        bytes[15] !== 0x52
    ) {
        return undefined;
    }
    const dv = viewOf(bytes);
    const width = dv.getUint32(16, false);
    const height = dv.getUint32(20, false);
    if (width <= 0 || height <= 0) return undefined;
    return { width, height };
}

// ─── GIF ─────────────────────────────────────────────────────────────────────

function isGif(bytes: Uint8Array): boolean {
    if (bytes.byteLength < 10) return false;
    // "GIF87a" or "GIF89a"
    if (
        bytes[0] !== 0x47 ||
        bytes[1] !== 0x49 ||
        bytes[2] !== 0x46 ||
        bytes[3] !== 0x38
    ) {
        return false;
    }
    return bytes[4] === 0x37 || bytes[4] === 0x39;
}

function readGifDimensions(bytes: Uint8Array): ImageDimensions | undefined {
    // Header: 6-byte signature, then 2-byte width LE + 2-byte height LE.
    const dv = viewOf(bytes);
    const width = dv.getUint16(6, true);
    const height = dv.getUint16(8, true);
    if (width <= 0 || height <= 0) return undefined;
    return { width, height };
}

// ─── WebP ────────────────────────────────────────────────────────────────────

function isWebp(bytes: Uint8Array): boolean {
    if (bytes.byteLength < 30) return false;
    // "RIFF" + 4-byte length + "WEBP"
    return (
        bytes[0] === 0x52 &&
        bytes[1] === 0x49 &&
        bytes[2] === 0x46 &&
        bytes[3] === 0x46 &&
        bytes[8] === 0x57 &&
        bytes[9] === 0x45 &&
        bytes[10] === 0x42 &&
        bytes[11] === 0x50
    );
}

function readWebpDimensions(bytes: Uint8Array): ImageDimensions | undefined {
    // Three WebP chunk variants: VP8 (lossy), VP8L (lossless), VP8X (extended).
    const fourcc = String.fromCharCode(bytes[12]!, bytes[13]!, bytes[14]!, bytes[15]!);
    const dv = viewOf(bytes);
    if (fourcc === 'VP8 ') {
        // Bytes 26-27: width-1, 28-29: height-1, both 14-bit LE.
        if (bytes.byteLength < 30) return undefined;
        const width = dv.getUint16(26, true) & 0x3fff;
        const height = dv.getUint16(28, true) & 0x3fff;
        return width > 0 && height > 0 ? { width, height } : undefined;
    }
    if (fourcc === 'VP8L') {
        if (bytes.byteLength < 25) return undefined;
        // Bytes 21-24 contain a packed 14+14 bit width-1, height-1.
        const b0 = bytes[21]!;
        const b1 = bytes[22]!;
        const b2 = bytes[23]!;
        const b3 = bytes[24]!;
        const width = 1 + (((b1 & 0x3f) << 8) | b0);
        const height = 1 + (((b3 & 0x0f) << 10) | (b2 << 2) | ((b1 & 0xc0) >> 6));
        return width > 0 && height > 0 ? { width, height } : undefined;
    }
    if (fourcc === 'VP8X') {
        if (bytes.byteLength < 30) return undefined;
        // Width-1 at bytes 24-26 (3-byte LE), height-1 at 27-29 (3-byte LE).
        const width = 1 + (bytes[24]! | (bytes[25]! << 8) | (bytes[26]! << 16));
        const height = 1 + (bytes[27]! | (bytes[28]! << 8) | (bytes[29]! << 16));
        return width > 0 && height > 0 ? { width, height } : undefined;
    }
    return undefined;
}

// ─── JPEG ────────────────────────────────────────────────────────────────────

function isJpeg(bytes: Uint8Array): boolean {
    return bytes.byteLength >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8;
}

function readJpegDimensions(bytes: Uint8Array): ImageDimensions | undefined {
    // Walk JPEG markers until we hit a Start-Of-Frame (SOFn) marker.
    // SOFn payload: 1-byte precision, 2-byte height, 2-byte width.
    let offset = 2; // skip SOI
    const len = bytes.byteLength;
    while (offset < len) {
        if (bytes[offset] !== 0xff) return undefined;
        // Skip fill bytes (0xFF padding).
        while (offset < len && bytes[offset] === 0xff) offset++;
        if (offset >= len) return undefined;
        const marker = bytes[offset]!;
        offset++;
        // Standalone markers (RST0-7, SOI, EOI, TEM) have no length payload.
        if (
            marker === 0x00 ||
            marker === 0x01 ||
            (marker >= 0xd0 && marker <= 0xd9)
        ) {
            continue;
        }
        // Read 2-byte BE length (includes the length bytes themselves).
        if (offset + 2 > len) return undefined;
        const segmentLen = (bytes[offset]! << 8) | bytes[offset + 1]!;
        if (segmentLen < 2) return undefined;
        // SOF0 (0xC0) through SOF15 (0xCF), excluding DHT (0xC4), JPG (0xC8),
        // DAC (0xCC) — these carry frame dimensions.
        if (
            (marker >= 0xc0 && marker <= 0xcf) &&
            marker !== 0xc4 &&
            marker !== 0xc8 &&
            marker !== 0xcc
        ) {
            // Payload starts after the 2-byte length. Layout: 1-byte precision,
            // 2-byte height, 2-byte width.
            const sofPayloadStart = offset + 2;
            if (sofPayloadStart + 5 > len) return undefined;
            const dv = viewOf(bytes);
            const height = dv.getUint16(sofPayloadStart + 1, false);
            const width = dv.getUint16(sofPayloadStart + 3, false);
            if (width <= 0 || height <= 0) return undefined;
            return { width, height };
        }
        offset += segmentLen;
    }
    return undefined;
}

// ─── BMP ─────────────────────────────────────────────────────────────────────

function isBmp(bytes: Uint8Array): boolean {
    return bytes.byteLength >= 26 && bytes[0] === 0x42 && bytes[1] === 0x4d;
}

function readBmpDimensions(bytes: Uint8Array): ImageDimensions | undefined {
    // BITMAPFILEHEADER (14 bytes) + BITMAPINFOHEADER. The INFOHEADER's first
    // 4 bytes are biSize. width is at bytes 18-21 (LE int32), height at 22-25.
    const dv = viewOf(bytes);
    const width = dv.getInt32(18, true);
    // Height is signed in BMP — negative means top-down — we want absolute.
    const height = Math.abs(dv.getInt32(22, true));
    if (width <= 0 || height <= 0) return undefined;
    return { width, height };
}

// ─── helpers ─────────────────────────────────────────────────────────────────

function viewOf(bytes: Uint8Array): DataView {
    return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

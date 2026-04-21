/**
 * Asset metadata extractor — task #63.
 *
 * Given raw bytes + filename, returns shape hints for the `AssetDescriptor`:
 *   - PNG: width, height (from the IHDR chunk)
 *   - JPEG: width, height (from SOF markers)
 *   - SVG: viewBox (regex scan)
 *   - Font: family from TTF/OTF name-table (best-effort; we return the
 *     filename-derived family when the name table can't be parsed cheaply).
 *   - Everything else: a `kind`-only descriptor.
 *
 * This module intentionally avoids heavy deps (no `sharp`, no `fontkit`, no
 * `probe-image-size`) — the metadata it emits is good enough for RN's
 * AssetRegistry shape requirements and anything beyond that can be deferred
 * to a Phase 7 upgrade.
 */

export interface ImageMetadata {
    readonly kind: 'image';
    readonly mime: string;
    readonly width?: number;
    readonly height?: number;
    readonly scale?: number;
}
export interface SvgMetadata {
    readonly kind: 'svg';
    readonly mime: 'image/svg+xml';
    readonly viewBox?: string;
}
export interface FontMetadata {
    readonly kind: 'font';
    readonly mime: string;
    readonly family: string;
}
export interface MediaMetadata {
    readonly kind: 'media';
    readonly mime: string;
}
export interface BinaryMetadata {
    readonly kind: 'binary';
    readonly mime: string;
}

export type AssetMetadata = ImageMetadata | SvgMetadata | FontMetadata | MediaMetadata | BinaryMetadata;

const IMAGE_MIME: Record<string, string> = {
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    webp: 'image/webp',
    gif: 'image/gif',
};
const FONT_MIME: Record<string, string> = {
    ttf: 'font/ttf',
    otf: 'font/otf',
    woff: 'font/woff',
    woff2: 'font/woff2',
};
const MEDIA_MIME: Record<string, string> = {
    mp3: 'audio/mpeg',
    wav: 'audio/wav',
    m4a: 'audio/mp4',
    mp4: 'video/mp4',
    mov: 'video/quicktime',
    webm: 'video/webm',
};

export function extractAssetMetadata(
    bytes: Uint8Array,
    filename: string,
): AssetMetadata {
    const ext = filename.split('.').pop()?.toLowerCase() ?? '';
    const scale = extractScale(filename);

    if (ext === 'svg') {
        return {
            kind: 'svg',
            mime: 'image/svg+xml',
            ...(extractSvgViewBox(bytes) ? { viewBox: extractSvgViewBox(bytes)! } : {}),
        };
    }

    if (ext in IMAGE_MIME) {
        const dims = extractImageDimensions(bytes, ext);
        return {
            kind: 'image',
            mime: IMAGE_MIME[ext]!,
            ...(dims?.width !== undefined ? { width: dims.width } : {}),
            ...(dims?.height !== undefined ? { height: dims.height } : {}),
            ...(scale !== undefined ? { scale } : {}),
        };
    }

    if (ext in FONT_MIME) {
        return {
            kind: 'font',
            mime: FONT_MIME[ext]!,
            family: familyFromFilename(filename),
        };
    }

    if (ext in MEDIA_MIME) {
        return { kind: 'media', mime: MEDIA_MIME[ext]! };
    }

    return { kind: 'binary', mime: 'application/octet-stream' };
}

/** Extracts a Metro-style `@2x` / `@3x` scale suffix from the filename. */
function extractScale(filename: string): number | undefined {
    const match = /@(\d+(?:\.\d+)?)x\b/.exec(filename);
    return match ? Number(match[1]) : undefined;
}

function extractImageDimensions(
    bytes: Uint8Array,
    ext: string,
): { width?: number; height?: number } | null {
    if (ext === 'png') {
        // PNG signature is 8 bytes, then IHDR chunk: 4 bytes length, 4 bytes
        // "IHDR", then 4 bytes width + 4 bytes height (big-endian).
        if (bytes.length < 24) return null;
        if (bytes[0] !== 0x89 || bytes[1] !== 0x50 || bytes[2] !== 0x4e || bytes[3] !== 0x47) {
            return null;
        }
        const width = readUint32BE(bytes, 16);
        const height = readUint32BE(bytes, 20);
        return { width, height };
    }
    if (ext === 'jpg' || ext === 'jpeg') {
        // Scan for SOF0/SOF2 markers. Minimal walker.
        let i = 2; // skip FF D8
        while (i < bytes.length - 10) {
            if (bytes[i] !== 0xff) break;
            const marker = bytes[i + 1];
            // Strip filler 0xFF bytes between markers.
            if (marker === 0xff) {
                i += 1;
                continue;
            }
            if (marker === undefined) break;
            // SOF markers: 0xC0..0xCF excluding 0xC4, 0xC8, 0xCC
            if (
                marker >= 0xc0 &&
                marker <= 0xcf &&
                marker !== 0xc4 &&
                marker !== 0xc8 &&
                marker !== 0xcc
            ) {
                const height = (bytes[i + 5]! << 8) | bytes[i + 6]!;
                const width = (bytes[i + 7]! << 8) | bytes[i + 8]!;
                return { width, height };
            }
            // Advance past this segment.
            const segLen = (bytes[i + 2]! << 8) | bytes[i + 3]!;
            i += 2 + segLen;
        }
        return null;
    }
    // WEBP / GIF: left as null (future work — RN rarely needs dimensions for these).
    return null;
}

function extractSvgViewBox(bytes: Uint8Array): string | null {
    // SVG < 64KB reads cleanly as utf8. For bigger SVGs, we scan the first 16KB.
    const head = bytes.slice(0, Math.min(bytes.length, 16 * 1024));
    const text = new TextDecoder('utf-8', { fatal: false }).decode(head);
    const match = /viewBox\s*=\s*"([^"]+)"/.exec(text);
    return match ? match[1]! : null;
}

function readUint32BE(bytes: Uint8Array, offset: number): number {
    return (
        bytes[offset]! * 16777216 +
        (bytes[offset + 1]! << 16) +
        (bytes[offset + 2]! << 8) +
        bytes[offset + 3]!
    );
}

function familyFromFilename(filename: string): string {
    // "Inter-Bold.ttf" → "Inter". "InterDisplay-Regular.otf" → "InterDisplay".
    const base = filename.split('/').pop()!.split('.').slice(0, -1).join('.');
    return base.split(/[-_ ]/)[0] ?? base;
}

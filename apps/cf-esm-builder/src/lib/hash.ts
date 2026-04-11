/**
 * Deterministic SHA256 of a canonicalised source tar (TH2.5).
 *
 * Hashing rules live in `plans/expo-browser-builder-protocol.md` §Hashing rules
 * and MUST match the editor-side `source-tar.ts` writer bit-for-bit:
 *
 *   1. Extract `(path, content)` pairs from the tar.
 *   2. Sort entries lexicographically (byte-wise) by path.
 *   3. SHA256 over the concatenation of, for each entry:
 *        utf8(path) || NUL || uint64BE(content.length) || content
 *   4. Return lower-hex (64 chars).
 *
 * Uses Web Crypto `SubtleCrypto.digest` (available in Workers and bun:test).
 *
 * The inline tar reader handles the `ustar`/v7 layout: 512-byte header blocks
 * with the path at offset 0 (100 bytes), size as octal at offset 124 (12 bytes),
 * and a 1-byte typeflag at offset 156. GNU long-name extensions (`L`/`K`) are
 * rejected for v1 — paths must fit in the 100-byte field. Pax (`x`/`g`) and
 * directory entries (`5`) are skipped without contributing to the hash.
 */

const BLOCK_SIZE = 512;
const NAME_OFFSET = 0;
const NAME_LENGTH = 100;
const SIZE_OFFSET = 124;
const SIZE_LENGTH = 12;
const TYPEFLAG_OFFSET = 156;
const PREFIX_OFFSET = 345;
const PREFIX_LENGTH = 155;
const MAGIC_OFFSET = 257;
const MAGIC_USTAR = 'ustar';

interface TarEntry {
    path: string;
    content: Uint8Array;
}

function readCString(buf: Uint8Array, offset: number, length: number): string {
    let end = offset;
    const limit = offset + length;
    while (end < limit && buf[end] !== 0) end++;
    return new TextDecoder('utf-8', { fatal: false }).decode(buf.subarray(offset, end));
}

function readOctal(buf: Uint8Array, offset: number, length: number): number {
    // tar size fields are NUL/space-terminated octal ASCII; ignore non-octal chars.
    let value = 0;
    const limit = offset + length;
    for (let i = offset; i < limit; i++) {
        const b = buf[i];
        if (b === undefined) break;
        if (b === 0 || b === 0x20) {
            if (value === 0) continue; // leading whitespace/NUL
            break;
        }
        if (b < 0x30 || b > 0x37) {
            // Non-octal byte — bail rather than silently produce wrong size.
            throw new Error('malformed tar: non-octal size byte');
        }
        value = value * 8 + (b - 0x30);
    }
    return value;
}

function isAllZero(buf: Uint8Array, offset: number, length: number): boolean {
    const limit = offset + length;
    for (let i = offset; i < limit; i++) {
        if (buf[i] !== 0) return false;
    }
    return true;
}

function parseTar(tar: ArrayBuffer): TarEntry[] {
    const view = new Uint8Array(tar);
    const entries: TarEntry[] = [];
    let offset = 0;

    while (offset + BLOCK_SIZE <= view.length) {
        // A pair of all-zero blocks marks end-of-archive.
        if (isAllZero(view, offset, BLOCK_SIZE)) {
            offset += BLOCK_SIZE;
            continue;
        }

        const name = readCString(view, offset + NAME_OFFSET, NAME_LENGTH);
        const size = readOctal(view, offset + SIZE_OFFSET, SIZE_LENGTH);
        const typeflag = view[offset + TYPEFLAG_OFFSET] ?? 0;

        // ustar prefix joins onto name when populated.
        const magic = readCString(view, offset + MAGIC_OFFSET, 6);
        let path = name;
        if (magic.startsWith(MAGIC_USTAR)) {
            const prefix = readCString(view, offset + PREFIX_OFFSET, PREFIX_LENGTH);
            if (prefix.length > 0) {
                path = `${prefix}/${name}`;
            }
        }

        // Reject GNU long-name extensions for v1 — fail clearly.
        if (typeflag === 0x4c /* 'L' */ || typeflag === 0x4b /* 'K' */) {
            throw new Error('malformed tar: GNU long-name extension not supported');
        }

        const dataStart = offset + BLOCK_SIZE;
        const padded = Math.ceil(size / BLOCK_SIZE) * BLOCK_SIZE;
        if (dataStart + size > view.length) {
            throw new Error('malformed tar: entry exceeds buffer');
        }

        const isFile =
            typeflag === 0 /* legacy */ ||
            typeflag === 0x30 /* '0' regular */ ||
            typeflag === 0x37; /* '7' contiguous (treat as regular) */

        if (isFile && path.length > 0) {
            const content = view.subarray(dataStart, dataStart + size);
            entries.push({ path, content });
        }
        // Directories ('5'), symlinks ('1'/'2'), pax ('x'/'g'), etc. are skipped.

        offset = dataStart + padded;
    }

    return entries;
}

function sortEntries(entries: TarEntry[]): TarEntry[] {
    // Byte-wise lexicographic sort on the UTF-8 path bytes.
    return entries.slice().sort((a, b) => {
        if (a.path < b.path) return -1;
        if (a.path > b.path) return 1;
        return 0;
    });
}

function uint64BE(n: number): Uint8Array {
    // JS Number safely represents up to 2^53; tar files inside our 100 MB cap
    // never approach that, so the high bits are always zero.
    const out = new Uint8Array(8);
    let lo = n >>> 0;
    let hi = Math.floor(n / 0x100000000) >>> 0;
    out[0] = (hi >>> 24) & 0xff;
    out[1] = (hi >>> 16) & 0xff;
    out[2] = (hi >>> 8) & 0xff;
    out[3] = hi & 0xff;
    out[4] = (lo >>> 24) & 0xff;
    out[5] = (lo >>> 16) & 0xff;
    out[6] = (lo >>> 8) & 0xff;
    out[7] = lo & 0xff;
    return out;
}

function toHex(buf: ArrayBuffer): string {
    const view = new Uint8Array(buf);
    let out = '';
    for (let i = 0; i < view.length; i++) {
        const b = view[i] ?? 0;
        out += b.toString(16).padStart(2, '0');
    }
    return out;
}

/** Plain SHA256 over arbitrary bytes — convenience helper. */
export async function sha256(data: ArrayBuffer | Uint8Array): Promise<string> {
    // Normalise into a fresh `ArrayBuffer` so SubtleCrypto.digest never sees a
    // SharedArrayBuffer-backed view (workers-types rejects that).
    let buf: ArrayBuffer;
    if (data instanceof Uint8Array) {
        const copy = new Uint8Array(data.byteLength);
        copy.set(data);
        buf = copy.buffer;
    } else {
        buf = data;
    }
    const digest = await crypto.subtle.digest('SHA-256', buf);
    return toHex(digest);
}

/**
 * SHA256 over a canonical-sorted source tree extracted from a tar.
 * Per TH0.2: deterministic hash. Same logical input → same hash regardless of
 * tar packing order.
 */
export async function sha256OfTar(tar: ArrayBuffer): Promise<string> {
    const entries = sortEntries(parseTar(tar));

    // Concatenate the canonical byte stream once, then hash. For tars within
    // our 100 MB cap this is well under Worker memory limits.
    const encoder = new TextEncoder();
    const parts: Uint8Array[] = [];
    let total = 0;
    for (const { path, content } of entries) {
        const pathBytes = encoder.encode(path);
        const lenBytes = uint64BE(content.length);
        parts.push(pathBytes, new Uint8Array([0]), lenBytes, content);
        total += pathBytes.length + 1 + 8 + content.length;
    }

    const buf = new Uint8Array(total);
    let pos = 0;
    for (const part of parts) {
        buf.set(part, pos);
        pos += part.length;
    }

    const digest = await crypto.subtle.digest('SHA-256', buf);
    return toHex(digest);
}

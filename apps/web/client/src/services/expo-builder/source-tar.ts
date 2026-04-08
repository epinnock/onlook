/**
 * Deterministic source-tar builder for cf-esm-builder uploads (TH4.2).
 *
 * Walks a `CodeFileSystem`, filters for project source files, and writes a
 * ustar-format tar buffer with byte-wise sorted entries. Determinism is
 * critical: identical inputs MUST produce byte-identical outputs so that
 * cf-esm-builder's content-addressed cache (`sha256(tar)`) can hit
 * reliably.
 *
 * The tar layout uses fixed metadata (mode 0644, uid/gid/mtime 0, owner
 * 'onlook') so that only the file paths and bytes contribute to the hash.
 *
 * We intentionally implement the tar format inline — the project forbids
 * adding a `tar` dependency.
 */

import type { CodeFileSystem } from '@onlook/file-system';

const DEFAULT_INCLUDE: readonly string[] = [
    'package.json',
    'app.json',
    'babel.config.js',
    'tsconfig.json',
    '.tsx',
    '.ts',
    '.jsx',
    '.js',
    '.mjs',
    '.cjs',
];

const DEFAULT_EXCLUDE: readonly string[] = [
    'node_modules/',
    '.git/',
    '.expo/',
    'dist/',
    'build/',
];

export interface SourceTarOptions {
    /** File extensions + special filenames to include. */
    include?: readonly string[];
    /** Path patterns to exclude (substring match). */
    exclude?: readonly string[];
}

export interface SourceTarFileEntry {
    path: string;
    size: number;
}

export interface SourceTarResult {
    /** Tar buffer ready to POST as application/x-tar. */
    tar: ArrayBuffer;
    /** Sorted list of files included (for hashing + debugging). */
    files: SourceTarFileEntry[];
    /** Total uncompressed bytes (sum of content, not tar overhead). */
    sizeBytes: number;
}

/**
 * Normalise a path to its forward-slash, leading-slash-stripped form. The
 * editor's CodeFileSystem returns entries like `/app/index.tsx` — we want
 * `app/index.tsx` inside the tar so that Container extraction lands under
 * its cwd.
 */
function normalisePath(input: string): string {
    let p = input.replace(/\\/g, '/');
    while (p.startsWith('/')) {
        p = p.slice(1);
    }
    return p;
}

function matchesInclude(relPath: string, include: readonly string[]): boolean {
    const base = relPath.split('/').pop() ?? relPath;
    for (const rule of include) {
        if (rule.startsWith('.')) {
            // Treat as extension (case-insensitive)
            if (relPath.toLowerCase().endsWith(rule.toLowerCase())) {
                return true;
            }
        } else {
            // Treat as literal filename match on the basename
            if (base === rule) {
                return true;
            }
        }
    }
    return false;
}

function matchesExclude(relPath: string, exclude: readonly string[]): boolean {
    for (const rule of exclude) {
        if (relPath.includes(rule)) {
            return true;
        }
    }
    return false;
}

function toUint8Array(content: string | Uint8Array): Uint8Array {
    if (typeof content === 'string') {
        return new TextEncoder().encode(content);
    }
    return content;
}

/**
 * Compare two strings byte-wise (not lexicographically via collation).
 * This matches the behaviour of `sort -z` in the reference implementation
 * and ensures the tar order is deterministic across locales.
 */
function byteCompare(a: string, b: string): number {
    const aBytes = new TextEncoder().encode(a);
    const bBytes = new TextEncoder().encode(b);
    const len = Math.min(aBytes.length, bBytes.length);
    for (let i = 0; i < len; i++) {
        const av = aBytes[i] ?? 0;
        const bv = bBytes[i] ?? 0;
        if (av !== bv) return av - bv;
    }
    return aBytes.length - bBytes.length;
}

/**
 * Write an ASCII string into a fixed-size header field at the given
 * offset. If the value is shorter than the field, the remaining bytes are
 * left as zeros (null-terminated).
 */
function writeAscii(header: Uint8Array, offset: number, length: number, value: string): void {
    const bytes = new TextEncoder().encode(value);
    const slice = bytes.slice(0, length);
    header.set(slice, offset);
}

/**
 * Write an octal number into a fixed-size header field followed by a
 * null/space terminator per the POSIX ustar spec. `length` INCLUDES the
 * terminator byte, so the number itself occupies `length - 1` characters.
 */
function writeOctal(header: Uint8Array, offset: number, length: number, value: number): void {
    const digits = length - 1;
    const str = value.toString(8).padStart(digits, '0');
    writeAscii(header, offset, digits, str);
    header[offset + digits] = 0x00;
}

/**
 * Build a single ustar file header for a regular file.
 */
function buildUstarHeader(path: string, size: number): Uint8Array {
    const header = new Uint8Array(512);

    if (path.length > 100) {
        // Onlook source trees are unlikely to exceed 100 chars, but fail
        // loudly rather than silently truncate — the hash would mismatch.
        throw new Error(
            `source-tar: path exceeds ustar 100-byte filename limit: ${path}`,
        );
    }

    // name (100), mode (8), uid (8), gid (8), size (12), mtime (12),
    // checksum (8, spaces during calc), typeflag (1), linkname (100),
    // magic (6) 'ustar\0', version (2) '00', uname (32), gname (32),
    // devmajor (8), devminor (8), prefix (155), padding (12).
    writeAscii(header, 0, 100, path);
    writeOctal(header, 100, 8, 0o644);
    writeOctal(header, 108, 8, 0);
    writeOctal(header, 116, 8, 0);
    writeOctal(header, 124, 12, size);
    writeOctal(header, 136, 12, 0); // mtime — fixed to epoch for determinism
    // Checksum placeholder: 8 spaces while computing.
    for (let i = 0; i < 8; i++) header[148 + i] = 0x20;
    header[156] = 0x30; // typeflag '0' = regular file
    // linkname left zero
    writeAscii(header, 257, 6, 'ustar\0');
    header[257 + 5] = 0x00;
    // magic is 6 bytes ending in NUL; writeAscii may have clobbered the
    // trailing NUL with 0x00 already — either way bytes 257..262 are
    // "ustar\0".
    header[263] = 0x30; // version '0'
    header[264] = 0x30; // version '0'
    writeAscii(header, 265, 32, 'onlook');
    writeAscii(header, 297, 32, 'onlook');
    writeOctal(header, 329, 8, 0);
    writeOctal(header, 337, 8, 0);
    // prefix + padding left zero

    // Compute checksum: sum of all header bytes (treating the checksum
    // field as spaces) written as a 6-digit octal number followed by NUL
    // and space.
    let sum = 0;
    for (let i = 0; i < 512; i++) {
        sum += header[i] ?? 0;
    }
    const checksumStr = sum.toString(8).padStart(6, '0');
    writeAscii(header, 148, 6, checksumStr);
    header[148 + 6] = 0x00;
    header[148 + 7] = 0x20;

    return header;
}

function padTo512(size: number): number {
    const rem = size % 512;
    return rem === 0 ? 0 : 512 - rem;
}

export async function createSourceTar(
    fs: CodeFileSystem,
    opts: SourceTarOptions = {},
): Promise<SourceTarResult> {
    const include = opts.include ?? DEFAULT_INCLUDE;
    const exclude = opts.exclude ?? DEFAULT_EXCLUDE;

    const entries = await fs.listAll();

    // Collect candidate file paths.
    const candidates: string[] = [];
    for (const entry of entries) {
        if (entry.type !== 'file') continue;
        const rel = normalisePath(entry.path);
        if (rel.length === 0) continue;
        if (matchesExclude(rel, exclude)) continue;
        if (!matchesInclude(rel, include)) continue;
        candidates.push(rel);
    }

    // Byte-wise sort for determinism.
    candidates.sort(byteCompare);

    // Deduplicate (in case normalisation collapses two entries to the
    // same path — unlikely but cheap insurance).
    const uniquePaths: string[] = [];
    for (const c of candidates) {
        if (uniquePaths[uniquePaths.length - 1] !== c) {
            uniquePaths.push(c);
        }
    }

    // Read each file and accumulate tar chunks.
    const chunks: Uint8Array[] = [];
    const fileList: SourceTarFileEntry[] = [];
    let totalBytes = 0;

    for (const relPath of uniquePaths) {
        // CodeFileSystem treats paths with leading slash from listAll; keep
        // the absolute form when reading so the wrapper resolves correctly.
        const readPath = `/${relPath}`;
        const raw = await fs.readFile(readPath);
        const body = toUint8Array(raw);
        const header = buildUstarHeader(relPath, body.length);
        chunks.push(header);
        chunks.push(body);
        const pad = padTo512(body.length);
        if (pad > 0) {
            chunks.push(new Uint8Array(pad));
        }
        fileList.push({ path: relPath, size: body.length });
        totalBytes += body.length;
    }

    // Ustar trailer: two 512-byte zero blocks.
    chunks.push(new Uint8Array(1024));

    // Concatenate.
    let total = 0;
    for (const c of chunks) total += c.length;
    const out = new Uint8Array(total);
    let offset = 0;
    for (const c of chunks) {
        out.set(c, offset);
        offset += c.length;
    }

    // ArrayBuffer slice to drop any trailing backing storage.
    return {
        tar: out.buffer.slice(out.byteOffset, out.byteOffset + out.byteLength),
        files: fileList,
        sizeBytes: totalBytes,
    };
}

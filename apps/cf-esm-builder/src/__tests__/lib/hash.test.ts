/**
 * Tests for `lib/hash.ts` (TH2.5).
 *
 * Expected hashes are precomputed against the canonical byte stream
 * `utf8(path) || NUL || uint64BE(len) || content` per TH0.2 §Hashing rules,
 * using Node's `crypto.createHash('sha256')`. See task plan for the offline
 * computation script.
 */
import { describe, expect, test } from 'bun:test';
import { sha256, sha256OfTar } from '../../lib/hash';

const BLOCK_SIZE = 512;

interface TarEntryInput {
    path: string;
    content: string;
}

/**
 * Build a minimal ustar tar buffer for testing. Each entry gets a 512-byte
 * header + content padded to a 512-byte boundary, plus a 1024-byte zero
 * trailer at the end. No long-name handling — paths must fit in 100 bytes.
 */
function makeTar(entries: TarEntryInput[]): ArrayBuffer {
    const encoder = new TextEncoder();
    const chunks: Uint8Array[] = [];

    for (const { path, content } of entries) {
        if (path.length > 100) {
            throw new Error('test helper: path too long (no long-name support)');
        }
        const contentBytes = encoder.encode(content);
        const header = new Uint8Array(BLOCK_SIZE);

        // name (offset 0, 100 bytes)
        const nameBytes = encoder.encode(path);
        header.set(nameBytes, 0);

        // mode (offset 100, 8 bytes) — "0000644\0"
        header.set(encoder.encode('0000644\0'), 100);
        // uid (offset 108, 8 bytes)
        header.set(encoder.encode('0000000\0'), 108);
        // gid (offset 116, 8 bytes)
        header.set(encoder.encode('0000000\0'), 116);

        // size (offset 124, 12 bytes) — octal ASCII, NUL-terminated
        const sizeOctal = contentBytes.length.toString(8).padStart(11, '0') + '\0';
        header.set(encoder.encode(sizeOctal), 124);

        // mtime (offset 136, 12 bytes)
        header.set(encoder.encode('00000000000\0'), 136);

        // chksum (offset 148, 8 bytes) — fill with spaces for checksum calc
        for (let i = 148; i < 156; i++) header[i] = 0x20;

        // typeflag (offset 156) — '0' regular file
        header[156] = 0x30;

        // magic (offset 257, 6 bytes) "ustar\0"
        header.set(encoder.encode('ustar\0'), 257);
        // version (offset 263, 2 bytes) "00"
        header.set(encoder.encode('00'), 263);

        // checksum: sum of all bytes (with chksum field as spaces), 6-digit octal + NUL + space
        let sum = 0;
        for (let i = 0; i < BLOCK_SIZE; i++) sum += header[i]!;
        const chksum = sum.toString(8).padStart(6, '0') + '\0 ';
        header.set(encoder.encode(chksum), 148);

        chunks.push(header);

        // content padded to next 512-byte boundary
        const padded = Math.ceil(contentBytes.length / BLOCK_SIZE) * BLOCK_SIZE;
        const contentBlock = new Uint8Array(padded);
        contentBlock.set(contentBytes, 0);
        chunks.push(contentBlock);
    }

    // Two 512-byte zero blocks = end-of-archive trailer.
    chunks.push(new Uint8Array(BLOCK_SIZE * 2));

    const total = chunks.reduce((acc, c) => acc + c.length, 0);
    const out = new Uint8Array(total);
    let pos = 0;
    for (const c of chunks) {
        out.set(c, pos);
        pos += c.length;
    }
    return out.buffer;
}

describe('lib/hash — sha256', () => {
    test('sha256 of "hello" matches known SHA256', async () => {
        const bytes = new TextEncoder().encode('hello');
        const hex = await sha256(bytes);
        expect(hex).toBe('2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824');
    });

    test('sha256 accepts ArrayBuffer input', async () => {
        const bytes = new TextEncoder().encode('hello');
        const hex = await sha256(bytes.buffer as ArrayBuffer);
        expect(hex).toBe('2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824');
    });

    test('sha256 output is exactly 64 hex chars', async () => {
        const hex = await sha256(new Uint8Array([1, 2, 3, 4, 5]));
        expect(hex.length).toBe(64);
        expect(hex).toMatch(/^[0-9a-f]{64}$/);
    });
});

describe('lib/hash — sha256OfTar', () => {
    test('hashes a 1-file tar to the known canonical hash', async () => {
        const tar = makeTar([{ path: 'App.tsx', content: 'hello world' }]);
        const hex = await sha256OfTar(tar);
        expect(hex).toBe('5a9a96a9aed7305d6e73ad9352b58de0b0cef01e4cd8f6d2274d22f6f8db72ec');
    });

    test('is deterministic across reordered entries (canonical-sort)', async () => {
        const entries = [
            { path: 'App.tsx', content: 'export default 1;' },
            { path: 'package.json', content: '{}' },
            { path: 'src/index.ts', content: 'console.log(1);' },
        ];
        const tarA = makeTar(entries);
        const tarB = makeTar([entries[2]!, entries[0]!, entries[1]!]);

        const hexA = await sha256OfTar(tarA);
        const hexB = await sha256OfTar(tarB);
        expect(hexA).toBe(hexB);
    });

    test('hashes a 3-file tar to the known canonical hash', async () => {
        const tar = makeTar([
            { path: 'App.tsx', content: 'export default 1;' },
            { path: 'package.json', content: '{}' },
            { path: 'src/index.ts', content: 'console.log(1);' },
        ]);
        const hex = await sha256OfTar(tar);
        expect(hex).toBe('132e89e61886fd3950096eaeb39b494f23edc0f8d73550d74d5a854e6e945acc');
    });

    test('output is exactly 64 hex chars', async () => {
        const tar = makeTar([{ path: 'a.txt', content: 'a' }]);
        const hex = await sha256OfTar(tar);
        expect(hex.length).toBe(64);
        expect(hex).toMatch(/^[0-9a-f]{64}$/);
    });

    test('empty tar (just the zero trailer) hashes as sha256 of empty input', async () => {
        const tar = makeTar([]);
        const hex = await sha256OfTar(tar);
        expect(hex).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    });

    test('rejects GNU long-name extension (typeflag L)', async () => {
        // Build a single-entry tar and flip its typeflag to 'L'.
        const tar = makeTar([{ path: 'longname-stub', content: 'x' }]);
        const view = new Uint8Array(tar);
        view[156] = 0x4c; // 'L'
        await expect(sha256OfTar(view.buffer as ArrayBuffer)).rejects.toThrow(/long-name/);
    });
});

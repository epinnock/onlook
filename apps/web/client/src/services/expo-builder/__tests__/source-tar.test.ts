/**
 * Tests for createSourceTar (TH4.2).
 *
 * Uses an in-memory fake that mimics the subset of CodeFileSystem used
 * by `createSourceTar` (`listAll` + `readFile`). This avoids booting
 * ZenFS/IndexedDB in a Bun test process — the real CodeFileSystem is
 * exercised indirectly via the orchestrator tests.
 */

import { describe, expect, test } from 'bun:test';

import type { CodeFileSystem } from '@onlook/file-system';

import { createSourceTar } from '../source-tar';

interface FakeFile {
    path: string;
    content: string | Uint8Array;
}

/**
 * Build a minimal stand-in that satisfies the methods `createSourceTar`
 * actually calls. We cast to `CodeFileSystem` because the helper only
 * uses `listAll` + `readFile`.
 */
function makeFakeFs(files: FakeFile[]): CodeFileSystem {
    // CodeFileSystem paths are absolute inside the Vfs (e.g. "/src/a.ts").
    const normalised = files.map((f) => ({
        path: f.path.startsWith('/') ? f.path : `/${f.path}`,
        content: f.content,
    }));

    const fake = {
        async listAll(): Promise<Array<{ path: string; type: 'file' | 'directory' }>> {
            // Include directory entries mirrored from file parents to match
            // the shape of the real listAll output.
            const dirSet = new Set<string>();
            for (const f of normalised) {
                const parts = f.path.split('/').filter(Boolean);
                let acc = '';
                for (let i = 0; i < parts.length - 1; i++) {
                    acc += `/${parts[i]}`;
                    dirSet.add(acc);
                }
            }
            const entries: Array<{ path: string; type: 'file' | 'directory' }> = [];
            for (const d of dirSet) {
                entries.push({ path: d, type: 'directory' });
            }
            for (const f of normalised) {
                entries.push({ path: f.path, type: 'file' });
            }
            // Deliberately randomise order to exercise the sort step.
            entries.sort((a, b) => (a.path < b.path ? 1 : -1));
            return entries;
        },
        async readFile(inputPath: string): Promise<string | Uint8Array> {
            const match = normalised.find((f) => f.path === inputPath);
            if (!match) throw new Error(`fake fs: missing ${inputPath}`);
            return match.content;
        },
    };

    return fake as unknown as CodeFileSystem;
}

function parseUstarHeaders(buffer: ArrayBuffer): Array<{ name: string; size: number }> {
    const bytes = new Uint8Array(buffer);
    const decoder = new TextDecoder();
    const out: Array<{ name: string; size: number }> = [];
    let offset = 0;
    while (offset + 512 <= bytes.length) {
        const header = bytes.slice(offset, offset + 512);
        // Detect zero block (trailer).
        let allZero = true;
        for (let i = 0; i < 512; i++) {
            if (header[i] !== 0) {
                allZero = false;
                break;
            }
        }
        if (allZero) break;
        const nameEnd = indexOfNul(header, 0, 100);
        const name = decoder.decode(header.slice(0, nameEnd));
        const sizeStr = decoder.decode(header.slice(124, 124 + 11)).replace(/\0+$/, '').trim();
        const size = parseInt(sizeStr, 8) || 0;
        out.push({ name, size });
        const pad = size % 512 === 0 ? 0 : 512 - (size % 512);
        offset += 512 + size + pad;
    }
    return out;
}

function indexOfNul(bytes: Uint8Array, start: number, length: number): number {
    for (let i = 0; i < length; i++) {
        if (bytes[start + i] === 0) return start + i - start;
    }
    return length;
}

function buffersEqual(a: ArrayBuffer, b: ArrayBuffer): boolean {
    if (a.byteLength !== b.byteLength) return false;
    const av = new Uint8Array(a);
    const bv = new Uint8Array(b);
    for (let i = 0; i < av.length; i++) {
        if (av[i] !== bv[i]) return false;
    }
    return true;
}

describe('createSourceTar', () => {
    test('empty fs produces a tar with only the 1024-byte trailer', async () => {
        const fs = makeFakeFs([]);
        const res = await createSourceTar(fs);
        expect(res.files).toHaveLength(0);
        expect(res.sizeBytes).toBe(0);
        expect(res.tar.byteLength).toBe(1024);
        const bytes = new Uint8Array(res.tar);
        for (let i = 0; i < 1024; i++) {
            expect(bytes[i]).toBe(0);
        }
    });

    test('includes source files in byte-wise sorted path order', async () => {
        const fs = makeFakeFs([
            { path: '/src/b.ts', content: 'export const b = 2;\n' },
            { path: '/src/a.ts', content: 'export const a = 1;\n' },
            { path: '/package.json', content: '{"name":"demo"}' },
        ]);
        const res = await createSourceTar(fs);
        expect(res.files.map((f) => f.path)).toEqual([
            'package.json',
            'src/a.ts',
            'src/b.ts',
        ]);
        const headers = parseUstarHeaders(res.tar);
        expect(headers.map((h) => h.name)).toEqual([
            'package.json',
            'src/a.ts',
            'src/b.ts',
        ]);
        // size matches body length
        expect(headers[0]!.size).toBe(new TextEncoder().encode('{"name":"demo"}').length);
    });

    test('excludes node_modules', async () => {
        const fs = makeFakeFs([
            { path: '/src/app.tsx', content: 'x' },
            { path: '/node_modules/react/index.js', content: 'module.exports = {};' },
        ]);
        const res = await createSourceTar(fs);
        expect(res.files.map((f) => f.path)).toEqual(['src/app.tsx']);
    });

    test('excludes non-source extensions', async () => {
        const fs = makeFakeFs([
            { path: '/src/app.tsx', content: 'x' },
            { path: '/src/icon.png', content: new Uint8Array([0, 1, 2]) },
            { path: '/README.md', content: '# hi' },
        ]);
        const res = await createSourceTar(fs);
        expect(res.files.map((f) => f.path)).toEqual(['src/app.tsx']);
    });

    test('package.json is always included by name', async () => {
        const fs = makeFakeFs([
            { path: '/package.json', content: '{}' },
            { path: '/tsconfig.json', content: '{}' },
            { path: '/app.json', content: '{}' },
            { path: '/other.json', content: '{}' },
        ]);
        const res = await createSourceTar(fs);
        expect(res.files.map((f) => f.path).sort()).toEqual([
            'app.json',
            'package.json',
            'tsconfig.json',
        ]);
    });

    test('is deterministic: identical inputs yield byte-identical tar', async () => {
        const input: FakeFile[] = [
            { path: '/src/a.ts', content: 'export const a = 1;\n' },
            { path: '/src/b.ts', content: 'export const b = 2;\n' },
            { path: '/package.json', content: '{"name":"demo"}' },
            { path: '/babel.config.js', content: 'module.exports = {};\n' },
        ];
        const first = await createSourceTar(makeFakeFs(input));
        const second = await createSourceTar(makeFakeFs(input.slice().reverse()));
        expect(first.tar.byteLength).toBe(second.tar.byteLength);
        expect(buffersEqual(first.tar, second.tar)).toBe(true);
    });

    test('respects custom include/exclude overrides', async () => {
        const fs = makeFakeFs([
            { path: '/extra/foo.md', content: '# md' },
            { path: '/src/app.tsx', content: 'x' },
        ]);
        const res = await createSourceTar(fs, {
            include: ['.md'],
            exclude: [],
        });
        expect(res.files.map((f) => f.path)).toEqual(['extra/foo.md']);
    });
});

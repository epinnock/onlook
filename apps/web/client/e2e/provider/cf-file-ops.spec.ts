/**
 * E2E-style tests for Cloudflare provider file operations.
 *
 * Uses a stateful in-memory mock sandbox to verify round-trip behaviour
 * (write -> read, write -> list -> delete, etc.) without a live CF account.
 *
 * Run with: bun test apps/web/client/e2e/provider/cf-file-ops.spec.ts
 */
import { describe, expect, it } from 'bun:test';
import {
    copyFiles,
    createDirectory,
    deleteFiles,
    downloadFiles,
    listFiles,
    readFile,
    statFile,
    writeFile,
    type SandboxFilesAPI,
} from '../../../../../packages/code-provider/src/providers/cloudflare/utils/files';

// ---------------------------------------------------------------------------
// Stateful in-memory mock sandbox
// ---------------------------------------------------------------------------

function createStatefulSandbox(): SandboxFilesAPI & {
    _store: Map<string, string>;
    _dirs: Set<string>;
} {
    const store = new Map<string, string>();
    const dirs = new Set<string>(['/workspace']);

    return {
        files: {
            read: async (path: string) => {
                const content = store.get(path);
                if (content === undefined) {
                    throw new Error(`File not found: ${path}`);
                }
                return content;
            },
            write: async (path: string, content: string) => {
                store.set(path, content);
            },
            list: async (path: string) => {
                const basePath = path.endsWith('/') ? path : `${path}/`;
                const entries: { name: string; type: 'file' | 'directory' }[] = [];
                const seen = new Set<string>();

                for (const key of store.keys()) {
                    if (key.startsWith(basePath)) {
                        const relative = key.slice(basePath.length);
                        const firstSegment = relative.split('/')[0]!;
                        if (!seen.has(firstSegment)) {
                            seen.add(firstSegment);
                            const isNested = relative.includes('/');
                            entries.push({
                                name: firstSegment,
                                type: isNested ? 'directory' : 'file',
                            });
                        }
                    }
                }

                for (const dir of dirs) {
                    if (dir.startsWith(basePath) && dir !== path) {
                        const relative = dir.slice(basePath.length);
                        const firstSegment = relative.split('/')[0]!;
                        if (firstSegment && !seen.has(firstSegment)) {
                            seen.add(firstSegment);
                            entries.push({ name: firstSegment, type: 'directory' });
                        }
                    }
                }

                return entries;
            },
            remove: async (path: string) => {
                if (!store.has(path)) {
                    throw new Error(`File not found: ${path}`);
                }
                store.delete(path);
            },
            mkdir: async (path: string) => {
                dirs.add(path);
            },
            stat: async (path: string) => {
                if (dirs.has(path)) {
                    return { size: 0, isDirectory: true, modifiedAt: new Date() };
                }
                const content = store.get(path);
                if (content === undefined) {
                    throw new Error(`File not found: ${path}`);
                }
                return {
                    size: new TextEncoder().encode(content).length,
                    isDirectory: false,
                    modifiedAt: new Date(),
                };
            },
        },
        _store: store,
        _dirs: dirs,
    };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('CF Provider File Operations (E2E)', () => {
    describe('write and read round-trip', () => {
        it('writes a file and reads it back with identical content', async () => {
            const sandbox = createStatefulSandbox();

            await writeFile(sandbox, '/workspace/test.txt', 'hello world');
            const content = await readFile(sandbox, '/workspace/test.txt');

            expect(content).toBe('hello world');
        });

        it('overwrites existing file content', async () => {
            const sandbox = createStatefulSandbox();

            await writeFile(sandbox, '/workspace/file.ts', 'v1');
            await writeFile(sandbox, '/workspace/file.ts', 'v2');
            const content = await readFile(sandbox, '/workspace/file.ts');

            expect(content).toBe('v2');
        });

        it('handles empty file content', async () => {
            const sandbox = createStatefulSandbox();

            await writeFile(sandbox, '/workspace/empty.txt', '');
            const content = await readFile(sandbox, '/workspace/empty.txt');

            expect(content).toBe('');
        });
    });

    describe('list files in directory', () => {
        it('lists files written to a directory', async () => {
            const sandbox = createStatefulSandbox();

            await writeFile(sandbox, '/workspace/a.ts', 'a');
            await writeFile(sandbox, '/workspace/b.ts', 'b');

            const files = await listFiles(sandbox, '/workspace');

            expect(files.length).toBe(2);
            const names = files.map((f) => f.name).sort();
            expect(names).toEqual(['a.ts', 'b.ts']);
        });

        it('returns full paths in FileEntry results', async () => {
            const sandbox = createStatefulSandbox();

            await writeFile(sandbox, '/workspace/index.ts', 'export {}');

            const files = await listFiles(sandbox, '/workspace');

            expect(files[0]!.path).toBe('/workspace/index.ts');
            expect(files[0]!.type).toBe('file');
        });

        it('returns empty array when directory has no files', async () => {
            const sandbox = createStatefulSandbox();

            const files = await listFiles(sandbox, '/workspace');

            expect(files).toEqual([]);
        });
    });

    describe('delete files', () => {
        it('removes a file and makes it unreadable', async () => {
            const sandbox = createStatefulSandbox();

            await writeFile(sandbox, '/workspace/temp.txt', 'temp');
            await deleteFiles(sandbox, ['/workspace/temp.txt']);

            await expect(readFile(sandbox, '/workspace/temp.txt')).rejects.toThrow(
                'File not found',
            );
        });

        it('removes multiple files at once', async () => {
            const sandbox = createStatefulSandbox();

            await writeFile(sandbox, '/workspace/a.ts', 'a');
            await writeFile(sandbox, '/workspace/b.ts', 'b');
            await writeFile(sandbox, '/workspace/c.ts', 'c');
            await deleteFiles(sandbox, ['/workspace/a.ts', '/workspace/c.ts']);

            // b.ts still accessible
            const content = await readFile(sandbox, '/workspace/b.ts');
            expect(content).toBe('b');

            // a.ts and c.ts gone
            await expect(readFile(sandbox, '/workspace/a.ts')).rejects.toThrow();
            await expect(readFile(sandbox, '/workspace/c.ts')).rejects.toThrow();
        });

        it('handles empty paths array gracefully', async () => {
            const sandbox = createStatefulSandbox();

            // Should not throw
            await deleteFiles(sandbox, []);
        });
    });

    describe('create directory', () => {
        it('creates a new directory', async () => {
            const sandbox = createStatefulSandbox();

            await createDirectory(sandbox, '/workspace/newdir');

            expect(sandbox._dirs.has('/workspace/newdir')).toBe(true);
        });

        it('creates nested directories', async () => {
            const sandbox = createStatefulSandbox();

            await createDirectory(sandbox, '/workspace/src/components/ui');

            expect(sandbox._dirs.has('/workspace/src/components/ui')).toBe(true);
        });
    });

    describe('download multiple files', () => {
        it('returns a Map of path -> content', async () => {
            const sandbox = createStatefulSandbox();

            await writeFile(sandbox, '/workspace/x.ts', 'x-content');
            await writeFile(sandbox, '/workspace/y.ts', 'y-content');

            const downloaded = await downloadFiles(sandbox, [
                '/workspace/x.ts',
                '/workspace/y.ts',
            ]);

            expect(downloaded).toBeInstanceOf(Map);
            expect(downloaded.get('/workspace/x.ts')).toBe('x-content');
            expect(downloaded.get('/workspace/y.ts')).toBe('y-content');
        });

        it('returns empty Map for empty paths', async () => {
            const sandbox = createStatefulSandbox();

            const downloaded = await downloadFiles(sandbox, []);

            expect(downloaded.size).toBe(0);
        });
    });

    describe('copy files', () => {
        it('copies content from source to destination', async () => {
            const sandbox = createStatefulSandbox();

            await writeFile(sandbox, '/workspace/original.ts', 'original content');
            await copyFiles(sandbox, '/workspace/original.ts', '/workspace/copy.ts');

            const content = await readFile(sandbox, '/workspace/copy.ts');
            expect(content).toBe('original content');

            // Original still intact
            const original = await readFile(sandbox, '/workspace/original.ts');
            expect(original).toBe('original content');
        });
    });

    describe('stat file', () => {
        it('returns file size and type for a regular file', async () => {
            const sandbox = createStatefulSandbox();

            await writeFile(sandbox, '/workspace/data.json', '{"key":"value"}');

            const stat = await statFile(sandbox, '/workspace/data.json');

            expect(stat).not.toBeNull();
            expect(stat!.isDirectory).toBe(false);
            expect(stat!.size).toBeGreaterThan(0);
        });

        it('returns isDirectory true for directories', async () => {
            const sandbox = createStatefulSandbox();

            await createDirectory(sandbox, '/workspace/mydir');

            const stat = await statFile(sandbox, '/workspace/mydir');

            expect(stat).not.toBeNull();
            expect(stat!.isDirectory).toBe(true);
        });

        it('returns null when stat is not implemented', async () => {
            const sandbox = createStatefulSandbox();
            // Remove stat to simulate sandbox without stat support
            sandbox.files.stat = undefined;

            const stat = await statFile(sandbox, '/workspace/anything');

            expect(stat).toBeNull();
        });
    });

    describe('multi-step workflows', () => {
        it('write, list, read, delete, verify gone', async () => {
            const sandbox = createStatefulSandbox();

            // Step 1: Write several files
            await writeFile(sandbox, '/workspace/app/index.ts', 'import "./main"');
            await writeFile(sandbox, '/workspace/app/main.ts', 'console.log("main")');
            await writeFile(sandbox, '/workspace/app/utils.ts', 'export {}');

            // Step 2: List them
            const files = await listFiles(sandbox, '/workspace/app');
            expect(files.length).toBe(3);

            // Step 3: Read one
            const content = await readFile(sandbox, '/workspace/app/main.ts');
            expect(content).toBe('console.log("main")');

            // Step 4: Delete one
            await deleteFiles(sandbox, ['/workspace/app/utils.ts']);

            // Step 5: Verify it's gone
            const remaining = await listFiles(sandbox, '/workspace/app');
            const names = remaining.map((f) => f.name).sort();
            expect(names).toEqual(['index.ts', 'main.ts']);
        });

        it('mkdir, write inside, list, download all', async () => {
            const sandbox = createStatefulSandbox();

            await createDirectory(sandbox, '/workspace/project/src');
            await writeFile(sandbox, '/workspace/project/src/a.ts', 'aaa');
            await writeFile(sandbox, '/workspace/project/src/b.ts', 'bbb');

            const files = await listFiles(sandbox, '/workspace/project/src');
            expect(files.length).toBe(2);

            const downloaded = await downloadFiles(
                sandbox,
                files.map((f) => f.path),
            );
            expect(downloaded.size).toBe(2);
            expect(downloaded.get('/workspace/project/src/a.ts')).toBe('aaa');
            expect(downloaded.get('/workspace/project/src/b.ts')).toBe('bbb');
        });
    });
});

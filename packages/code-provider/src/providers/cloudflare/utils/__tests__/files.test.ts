import { describe, expect, it, mock } from 'bun:test';
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
} from '../files';

function createMockSandbox(overrides?: Partial<SandboxFilesAPI['files']>): SandboxFilesAPI {
    return {
        files: {
            read: mock(() => Promise.resolve('file-content')),
            write: mock(() => Promise.resolve()),
            list: mock(() =>
                Promise.resolve([
                    { name: 'index.ts', type: 'file' as const },
                    { name: 'src', type: 'directory' as const },
                ]),
            ),
            remove: mock(() => Promise.resolve()),
            mkdir: mock(() => Promise.resolve()),
            stat: mock(() =>
                Promise.resolve({
                    size: 1024,
                    isDirectory: false,
                    modifiedAt: new Date('2025-01-01'),
                }),
            ),
            ...overrides,
        },
    };
}

describe('readFile', () => {
    it('returns file content from sandbox', async () => {
        const sandbox = createMockSandbox({
            read: mock(() => Promise.resolve('hello world')),
        });

        const result = await readFile(sandbox, '/app/index.ts');

        expect(result).toBe('hello world');
        expect(sandbox.files.read).toHaveBeenCalledWith('/app/index.ts');
    });
});

describe('writeFile', () => {
    it('writes content to sandbox', async () => {
        const sandbox = createMockSandbox();

        await writeFile(sandbox, '/app/index.ts', 'console.log("hi")');

        expect(sandbox.files.write).toHaveBeenCalledWith('/app/index.ts', 'console.log("hi")');
    });
});

describe('listFiles', () => {
    it('returns FileEntry[] with full paths', async () => {
        const sandbox = createMockSandbox();

        const result = await listFiles(sandbox, '/app');

        expect(result).toEqual([
            { name: 'index.ts', type: 'file', path: '/app/index.ts' },
            { name: 'src', type: 'directory', path: '/app/src' },
        ]);
    });

    it('handles trailing slash in base path', async () => {
        const sandbox = createMockSandbox();

        const result = await listFiles(sandbox, '/app/');

        expect(result[0]!.path).toBe('/app/index.ts');
    });
});

describe('deleteFiles', () => {
    it('removes all provided paths', async () => {
        const sandbox = createMockSandbox();

        await deleteFiles(sandbox, ['/a.ts', '/b.ts', '/c.ts']);

        expect(sandbox.files.remove).toHaveBeenCalledTimes(3);
        expect(sandbox.files.remove).toHaveBeenCalledWith('/a.ts');
        expect(sandbox.files.remove).toHaveBeenCalledWith('/b.ts');
        expect(sandbox.files.remove).toHaveBeenCalledWith('/c.ts');
    });

    it('handles empty paths array', async () => {
        const sandbox = createMockSandbox();

        await deleteFiles(sandbox, []);

        expect(sandbox.files.remove).toHaveBeenCalledTimes(0);
    });
});

describe('createDirectory', () => {
    it('creates directory recursively', async () => {
        const sandbox = createMockSandbox();

        await createDirectory(sandbox, '/app/src/components');

        expect(sandbox.files.mkdir).toHaveBeenCalledWith('/app/src/components', {
            recursive: true,
        });
    });
});

describe('statFile', () => {
    it('returns file stats when stat is available', async () => {
        const date = new Date('2025-01-01');
        const sandbox = createMockSandbox({
            stat: mock(() =>
                Promise.resolve({ size: 512, isDirectory: false, modifiedAt: date }),
            ),
        });

        const result = await statFile(sandbox, '/app/index.ts');

        expect(result).toEqual({ size: 512, isDirectory: false, modifiedAt: date });
    });

    it('returns null when stat is not implemented', async () => {
        const sandbox = createMockSandbox({ stat: undefined });

        const result = await statFile(sandbox, '/app/index.ts');

        expect(result).toBeNull();
    });
});

describe('copyFiles', () => {
    it('reads source and writes to destination', async () => {
        const sandbox = createMockSandbox({
            read: mock(() => Promise.resolve('source content')),
        });

        await copyFiles(sandbox, '/src/a.ts', '/dest/a.ts');

        expect(sandbox.files.read).toHaveBeenCalledWith('/src/a.ts');
        expect(sandbox.files.write).toHaveBeenCalledWith('/dest/a.ts', 'source content');
    });
});

describe('downloadFiles', () => {
    it('bulk reads files and returns a Map', async () => {
        let callCount = 0;
        const sandbox = createMockSandbox({
            read: mock(() => {
                callCount++;
                return Promise.resolve(`content-${callCount}`);
            }),
        });

        const result = await downloadFiles(sandbox, ['/a.ts', '/b.ts']);

        expect(result).toBeInstanceOf(Map);
        expect(result.size).toBe(2);
        expect(result.has('/a.ts')).toBe(true);
        expect(result.has('/b.ts')).toBe(true);
    });

    it('returns empty Map for empty paths', async () => {
        const sandbox = createMockSandbox();

        const result = await downloadFiles(sandbox, []);

        expect(result.size).toBe(0);
    });
});

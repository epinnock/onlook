/**
 * Cloudflare Sandbox file operation utilities.
 *
 * All functions accept a generic sandbox object that satisfies SandboxFilesAPI,
 * so callers are not forced to import the Cloudflare SDK at the type level.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SandboxFilesAPI {
    files: {
        read(path: string): Promise<string>;
        write(path: string, content: string): Promise<void>;
        list(path: string): Promise<{ name: string; type: 'file' | 'directory' }[]>;
        remove(path: string): Promise<void>;
        mkdir(path: string, options?: { recursive?: boolean }): Promise<void>;
        stat?(path: string): Promise<{ size: number; isDirectory: boolean; modifiedAt: Date }>;
    };
}

export interface FileEntry {
    name: string;
    type: 'file' | 'directory';
    path: string;
}

export interface FileStat {
    size: number;
    isDirectory: boolean;
    modifiedAt: Date;
}

// ---------------------------------------------------------------------------
// File operations
// ---------------------------------------------------------------------------

export async function readFile(sandbox: SandboxFilesAPI, path: string): Promise<string> {
    return sandbox.files.read(path);
}

export async function writeFile(
    sandbox: SandboxFilesAPI,
    path: string,
    content: string,
): Promise<void> {
    await sandbox.files.write(path, content);
}

export async function listFiles(
    sandbox: SandboxFilesAPI,
    path: string,
): Promise<FileEntry[]> {
    const entries = await sandbox.files.list(path);
    const basePath = path.endsWith('/') ? path : `${path}/`;

    return entries.map((entry) => ({
        name: entry.name,
        type: entry.type,
        path: `${basePath}${entry.name}`,
    }));
}

export async function deleteFiles(
    sandbox: SandboxFilesAPI,
    paths: string[],
): Promise<void> {
    await Promise.all(paths.map((p) => sandbox.files.remove(p)));
}

export async function createDirectory(
    sandbox: SandboxFilesAPI,
    path: string,
): Promise<void> {
    await sandbox.files.mkdir(path, { recursive: true });
}

export async function statFile(
    sandbox: SandboxFilesAPI,
    path: string,
): Promise<FileStat | null> {
    if (!sandbox.files.stat) {
        return null;
    }

    const info = await sandbox.files.stat(path);
    return {
        size: info.size,
        isDirectory: info.isDirectory,
        modifiedAt: info.modifiedAt,
    };
}

export async function copyFiles(
    sandbox: SandboxFilesAPI,
    src: string,
    dest: string,
): Promise<void> {
    const content = await sandbox.files.read(src);
    await sandbox.files.write(dest, content);
}

export async function downloadFiles(
    sandbox: SandboxFilesAPI,
    paths: string[],
): Promise<Map<string, string>> {
    const results = new Map<string, string>();
    const entries = await Promise.all(
        paths.map(async (p) => {
            const content = await sandbox.files.read(p);
            return [p, content] as const;
        }),
    );

    for (const [p, content] of entries) {
        results.set(p, content);
    }

    return results;
}

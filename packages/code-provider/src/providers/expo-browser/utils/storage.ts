/**
 * Supabase Storage adapter for the ExpoBrowserProvider.
 *
 * Wraps the @supabase/supabase-js Storage client to expose the file
 * operations the Provider abstract class needs. The bucket is private
 * (server-side checks own auth via RLS) and keyed by:
 *
 *     <projectId>/<branchId>/<filePath>
 *
 * No directory hierarchy semantics — Supabase Storage is flat object
 * storage. listFiles emulates directories by listing all keys with the
 * given prefix and grouping by the next slash.
 *
 * Wave A (TA.5). Wired into ExpoBrowserProvider in TA.8.
 */

import {
    createClient,
    type SupabaseClient,
} from '@supabase/supabase-js';

/**
 * Subset of Supabase's FileObject we use. The full type isn't a
 * top-level export of @supabase/supabase-js, so we model the fields we
 * actually touch and let TypeScript structurally type-check the rest.
 */
interface StorageEntry {
    name: string;
    id: string | null;
    metadata?: { size?: number; lastModified?: string } | null;
}
import type {
    CopyFileOutput,
    CopyFilesInput,
    CreateDirectoryInput,
    CreateDirectoryOutput,
    DeleteFilesInput,
    DeleteFilesOutput,
    DownloadFilesInput,
    DownloadFilesOutput,
    ListFilesInput,
    ListFilesOutput,
    ListFilesOutputFile,
    ReadFileInput,
    ReadFileOutput,
    RenameFileInput,
    RenameFileOutput,
    StatFileInput,
    StatFileOutput,
    WriteFileInput,
    WriteFileOutput,
} from '../../../types';

export interface StorageAdapterOptions {
    /** Project UUID — top-level prefix in the bucket. */
    projectId: string;
    /** Branch UUID — second-level prefix. */
    branchId: string;
    /** Bucket name. Defaults to 'expo-projects'. */
    bucket?: string;
    /** Public Supabase URL (e.g. http://127.0.0.1:54321 for local dev). */
    supabaseUrl: string;
    /**
     * Anon or service key. The browser provider uses the anon key + Supabase
     * RLS for auth. The server-side instance can use a service key.
     */
    supabaseKey: string;
    /** Optional pre-built Supabase client (for tests + DI). */
    client?: SupabaseClient;
}

/**
 * Public, mockable interface so the unit tests in TA.8 can drop in a fake.
 */
export interface StorageAdapter {
    writeFile(input: WriteFileInput): Promise<WriteFileOutput>;
    readFile(input: ReadFileInput): Promise<ReadFileOutput>;
    listFiles(input: ListFilesInput): Promise<ListFilesOutput>;
    statFile(input: StatFileInput): Promise<StatFileOutput>;
    deleteFiles(input: DeleteFilesInput): Promise<DeleteFilesOutput>;
    renameFile(input: RenameFileInput): Promise<RenameFileOutput>;
    copyFiles(input: CopyFilesInput): Promise<CopyFileOutput>;
    createDirectory(input: CreateDirectoryInput): Promise<CreateDirectoryOutput>;
    downloadFiles(input: DownloadFilesInput): Promise<DownloadFilesOutput>;
}

/**
 * Sentinel placeholder file written when createDirectory is called. Supabase
 * Storage has no native directory concept; the placeholder ensures listFiles
 * still surfaces the "directory" until a real file is added under it.
 */
const DIR_PLACEHOLDER = '.onlook-dir-placeholder';

const DEFAULT_BUCKET = 'expo-projects';

/**
 * Returns true when `path` contains a `..` segment that would escape
 * the current directory. Matches the segment as a whole — `..foo` is
 * allowed, `foo/../bar` is rejected. Exported for tests.
 */
export function containsParentSegment(path: string): boolean {
    if (!path) return false;
    return path.split(/[/\\]/).some((segment) => segment === '..');
}

export class SupabaseStorageAdapter implements StorageAdapter {
    private readonly client: SupabaseClient;
    private readonly bucket: string;
    private readonly prefix: string;

    constructor(options: StorageAdapterOptions) {
        this.client =
            options.client ??
            createClient(options.supabaseUrl, options.supabaseKey, {
                auth: { persistSession: false, autoRefreshToken: false },
            });
        this.bucket = options.bucket ?? DEFAULT_BUCKET;
        this.prefix = `${options.projectId}/${options.branchId}`;
    }

    private storage() {
        return this.client.storage.from(this.bucket);
    }

    /** Translate a logical path (e.g. 'src/App.tsx') to a bucket key. */
    private toKey(logicalPath: string): string {
        // Strip leading slashes, leading './', and a bare '.' (root) so the
        // resulting key is `${prefix}` for the branch root and
        // `${prefix}/foo/bar` for everything else. Without this, listFiles('.')
        // would call storage.list('${prefix}/.'), which Supabase treats as a
        // literal directory called "." and returns no results.
        const trimmed = logicalPath
            .replace(/^\/+/, '')
            .replace(/^\.\//, '')
            .replace(/^\.$/, '');

        // Reject path traversal: `..` segments in the logical path would
        // escape the `${projectId}/${branchId}` prefix if Supabase ever
        // resolved the key, and at minimum produce weird storage keys
        // that break the fromKey reverse mapping and listing UX. The
        // editor's CodeFileSystem normalizes paths before reaching the
        // provider, so this only fires on a misbehaving caller — treat it
        // as a programming error rather than a silent fallback.
        if (containsParentSegment(trimmed)) {
            throw new Error(
                `ExpoBrowser storage: path traversal segment (".") rejected in logical path: ${logicalPath}`,
            );
        }

        return trimmed.length === 0 ? this.prefix : `${this.prefix}/${trimmed}`;
    }

    /**
     * Strip the per-branch prefix from a bucket key to recover the logical
     * path. Symmetric inverse of toKey, with a few defensive cases:
     *   - `${prefix}`           -> ''   (bare prefix, branch root — mirrors toKey('.'))
     *   - `${prefix}/`          -> ''   (trailing slash from directory listings)
     *   - `${prefix}//foo`      -> 'foo' (duplicate slash after prefix)
     *   - `${prefix}/foo/bar/`  -> 'foo/bar' (trailing slash on nested key)
     *   - 'unrelated/key'       -> 'unrelated/key' (no match — passthrough)
     */
    private fromKey(key: string): string {
        if (key === this.prefix) {
            return '';
        }
        if (key.startsWith(`${this.prefix}/`)) {
            // Drop the prefix + separator, then collapse any leading slashes
            // (handles `${prefix}//foo`) and any trailing slash (handles
            // directory-listing keys like `${prefix}/foo/`).
            return key
                .slice(this.prefix.length + 1)
                .replace(/^\/+/, '')
                .replace(/\/+$/, '');
        }
        return key;
    }

    async writeFile(input: WriteFileInput): Promise<WriteFileOutput> {
        const key = this.toKey(input.args.path);
        const content = input.args.content;
        const body =
            typeof content === 'string'
                ? new Blob([content], { type: 'text/plain' })
                : // Wrap Uint8Array in a fresh ArrayBuffer slice so TS sees a
                  // plain BlobPart (the lib.dom.d.ts BlobPart type forbids
                  // generic Uint8Array<ArrayBufferLike>).
                  new Blob([new Uint8Array(content).buffer]);

        const { error } = await this.storage().upload(key, body, {
            upsert: input.args.overwrite ?? true,
            contentType: 'application/octet-stream',
        });
        if (error) {
            // Re-throw with context so the caller can surface a useful error.
            throw new Error(`storage.upload failed for ${key}: ${error.message}`);
        }
        return { success: true };
    }

    async readFile(input: ReadFileInput): Promise<ReadFileOutput> {
        const key = this.toKey(input.args.path);
        const { data, error } = await this.storage().download(key);
        if (error || !data) {
            throw new Error(
                `storage.download failed for ${key}: ${error?.message ?? 'no data'}`,
            );
        }
        const text = await data.text();
        return {
            file: {
                path: input.args.path,
                content: text,
                type: 'text',
                toString: () => text,
            },
        };
    }

    async listFiles(input: ListFilesInput): Promise<ListFilesOutput> {
        const dirKey = this.toKey(input.args.path);
        // Supabase storage list expects the folder path WITHIN the bucket,
        // and treats slash as a separator when search is empty.
        const { data, error } = await this.storage().list(dirKey, {
            limit: 1000,
            sortBy: { column: 'name', order: 'asc' },
        });
        if (error) {
            throw new Error(`storage.list failed for ${dirKey}: ${error.message}`);
        }
        const files: ListFilesOutputFile[] = (data ?? [])
            .filter((entry: StorageEntry) => entry.name !== DIR_PLACEHOLDER)
            .map((entry: StorageEntry) => ({
                name: entry.name,
                // Supabase 'folders' have null id (and metadata.size is null).
                type: entry.id == null ? ('directory' as const) : ('file' as const),
                isSymlink: false,
            }));
        return { files };
    }

    async statFile(input: StatFileInput): Promise<StatFileOutput> {
        // Supabase Storage doesn't have a true stat. List the parent and find
        // the entry — costs one round-trip but matches the existing CSB
        // contract for `type` + optional metadata.
        const key = this.toKey(input.args.path);
        const lastSlash = key.lastIndexOf('/');
        const parentKey = lastSlash === -1 ? '' : key.slice(0, lastSlash);
        const name = key.slice(lastSlash + 1);
        const { data, error } = await this.storage().list(parentKey, {
            limit: 1,
            search: name,
        });
        if (error) {
            throw new Error(`storage.stat failed for ${key}: ${error.message}`);
        }
        const entry = (data ?? []).find((e) => e.name === name);
        if (!entry) {
            throw new Error(`stat: not found ${input.args.path}`);
        }
        const metadata = (entry.metadata ?? {}) as { size?: number; lastModified?: string };
        return {
            type: entry.id == null ? 'directory' : 'file',
            isSymlink: false,
            size: metadata.size,
            mtime: metadata.lastModified ? new Date(metadata.lastModified).getTime() : undefined,
        };
    }

    async deleteFiles(input: DeleteFilesInput): Promise<DeleteFilesOutput> {
        const key = this.toKey(input.args.path);

        if (input.args.recursive) {
            // Walk the prefix and delete every key beneath it.
            const allKeys = await this.listAllKeys(key);
            if (allKeys.length === 0) {
                // The path may itself be a single object — try direct.
                const { error } = await this.storage().remove([key]);
                if (error) {
                    throw new Error(
                        `storage.remove failed for ${key}: ${error.message}`,
                    );
                }
                return {};
            }
            const { error } = await this.storage().remove(allKeys);
            if (error) {
                throw new Error(
                    `storage.remove (recursive) failed for ${key}: ${error.message}`,
                );
            }
            return {};
        }

        const { error } = await this.storage().remove([key]);
        if (error) {
            throw new Error(`storage.remove failed for ${key}: ${error.message}`);
        }
        return {};
    }

    async renameFile(input: RenameFileInput): Promise<RenameFileOutput> {
        const fromKey = this.toKey(input.args.oldPath);
        const toKey = this.toKey(input.args.newPath);
        const { error } = await this.storage().move(fromKey, toKey);
        if (error) {
            throw new Error(
                `storage.move ${fromKey} -> ${toKey} failed: ${error.message}`,
            );
        }
        return {};
    }

    async copyFiles(input: CopyFilesInput): Promise<CopyFileOutput> {
        const fromKey = this.toKey(input.args.sourcePath);
        const toKey = this.toKey(input.args.targetPath);

        if (input.args.recursive) {
            const allKeys = await this.listAllKeys(fromKey);
            if (allKeys.length === 0) {
                // Single object copy.
                const { error } = await this.storage().copy(fromKey, toKey);
                if (error) {
                    throw new Error(
                        `storage.copy ${fromKey} -> ${toKey} failed: ${error.message}`,
                    );
                }
                return {};
            }
            // Recursive copy: rewrite each source key under the target prefix.
            for (const sourceKey of allKeys) {
                const relativeKey = sourceKey.slice(fromKey.length);
                const targetSubKey = `${toKey}${relativeKey}`;
                const { error } = await this.storage().copy(sourceKey, targetSubKey);
                if (error) {
                    throw new Error(
                        `storage.copy ${sourceKey} -> ${targetSubKey} failed: ${error.message}`,
                    );
                }
            }
            return {};
        }

        const { error } = await this.storage().copy(fromKey, toKey);
        if (error) {
            throw new Error(
                `storage.copy ${fromKey} -> ${toKey} failed: ${error.message}`,
            );
        }
        return {};
    }

    async createDirectory(input: CreateDirectoryInput): Promise<CreateDirectoryOutput> {
        // Supabase Storage has no native directories. Drop a zero-byte
        // placeholder so listFiles can still surface the directory.
        const placeholderKey = `${this.toKey(input.args.path)}/${DIR_PLACEHOLDER}`;
        const { error } = await this.storage().upload(
            placeholderKey,
            new Blob([], { type: 'application/octet-stream' }),
            { upsert: true },
        );
        if (error) {
            throw new Error(
                `storage.createDirectory failed for ${input.args.path}: ${error.message}`,
            );
        }
        return {};
    }

    async downloadFiles(input: DownloadFilesInput): Promise<DownloadFilesOutput> {
        const key = this.toKey(input.args.path);
        const { data, error } = await this.storage().createSignedUrl(key, 60 * 60);
        if (error || !data) {
            throw new Error(
                `storage.createSignedUrl failed for ${key}: ${error?.message ?? 'no data'}`,
            );
        }
        return { url: data.signedUrl };
    }

    /**
     * Recursively walk a prefix and return every full bucket key beneath it.
     * Used by deleteFiles({recursive:true}) and copyFiles({recursive:true}).
     */
    private async listAllKeys(rootKey: string): Promise<string[]> {
        const out: string[] = [];
        const stack: string[] = [rootKey];
        while (stack.length > 0) {
            const current = stack.pop()!;
            const { data, error } = await this.storage().list(current, {
                limit: 1000,
                sortBy: { column: 'name', order: 'asc' },
            });
            if (error) {
                throw new Error(
                    `storage.listAllKeys failed for ${current}: ${error.message}`,
                );
            }
            for (const entry of data ?? []) {
                if (entry.name === DIR_PLACEHOLDER) continue;
                const childKey = current ? `${current}/${entry.name}` : entry.name;
                if (entry.id == null) {
                    // It's a folder — recurse.
                    stack.push(childKey);
                } else {
                    out.push(childKey);
                }
            }
        }
        return out;
    }
}

/**
 * file-walker — recursively walks a Vfs and yields source files.
 *
 * Extracted from host/index.ts (Wave R2 / TR2.1) so the bundler, hash
 * pipeline, and downstream Phase H consumers share a single, deterministic
 * traversal implementation.
 */

import type { Vfs } from './types';

const DEFAULT_EXCLUDES = ['node_modules', '.git', 'dist', 'build', '.next'];
const DEFAULT_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'];

export interface VfsFile {
    /** Normalized relative path (no leading slash). */
    path: string;
    /** UTF-8 string content. */
    content: string;
}

export interface WalkOptions {
    /** Directory names to exclude (default: ['node_modules', '.git', 'dist', 'build', '.next']). */
    excludes?: string[];
    /** File extensions to include (default: ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs']). */
    extensions?: string[];
}

/**
 * Recursively walks a Vfs and returns every source file with its content.
 * Filters out excluded directories and non-source extensions.
 * Normalizes paths (strips leading slash) for consistent keying.
 * Output is sorted by path for deterministic downstream hashing.
 */
export async function walkVfs(vfs: Vfs, opts?: WalkOptions): Promise<VfsFile[]> {
    const excludes = opts?.excludes ?? DEFAULT_EXCLUDES;
    const extensions = opts?.extensions ?? DEFAULT_EXTENSIONS;
    const excludeSet = new Set(excludes);

    const entries = await vfs.listAll();

    const candidatePaths = entries
        .filter((e) => e.type === 'file')
        .map((e) => normalizeRelative(e.path))
        .filter((p) => !isExcluded(p, excludeSet))
        .filter((p) => hasSourceExtension(p, extensions))
        .sort();

    const out: VfsFile[] = [];
    for (const path of candidatePaths) {
        // Read using the original (un-normalized) entry path if it differed,
        // but since the Vfs accepts either form in practice we re-resolve via
        // the normalized path which is also what callers will key on.
        const raw = await vfs.readFile(path);
        const content = typeof raw === 'string' ? raw : new TextDecoder().decode(raw);
        out.push({ path, content });
    }

    return out;
}

function normalizeRelative(filePath: string): string {
    return filePath.startsWith('/') ? filePath.slice(1) : filePath;
}

function isExcluded(filePath: string, excludeSet: Set<string>): boolean {
    const segments = filePath.split('/');
    for (const seg of segments) {
        if (excludeSet.has(seg)) return true;
    }
    return false;
}

function hasSourceExtension(filePath: string, extensions: string[]): boolean {
    const lower = filePath.toLowerCase();
    return extensions.some((ext) => lower.endsWith(ext.toLowerCase()));
}

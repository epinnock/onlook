/**
 * Snack file operations utility.
 *
 * Snack stores files as an in-memory flat map where keys are POSIX paths and
 * values are either `{ type: 'CODE'; contents: string }` or `null` (deleted).
 * Directories are virtual — they are derived from path prefixes.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SnackFile {
    type: 'CODE';
    contents: string;
}

export interface SnackState {
    files: Record<string, SnackFile | null>;
}

export interface SnackInstance {
    updateFiles(files: Record<string, SnackFile | null>): void;
    getState(): SnackState;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Normalise a path by stripping leading/trailing slashes. */
function normalisePath(p: string): string {
    return p.replace(/^\/+|\/+$/g, '');
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Read a single file from the Snack state.
 * Returns the file contents or `null` when the file does not exist (or has
 * been deleted).
 */
export function readSnackFile(state: SnackState, path: string): string | null {
    const norm = normalisePath(path);
    const entry = state.files[norm];
    if (entry && entry.type === 'CODE') {
        return entry.contents;
    }
    return null;
}

/**
 * Write (create or overwrite) a file in the Snack instance.
 */
export function writeSnackFile(snack: SnackInstance, path: string, content: string): void {
    const norm = normalisePath(path);
    snack.updateFiles({ [norm]: { type: 'CODE', contents: content } });
}

/**
 * List the immediate children of `basePath`.
 *
 * Because Snack has no real directories we derive them from path prefixes.
 * Files whose path equals `<basePath>/<name>` (no further slash) are reported
 * as files; deeper paths contribute a synthetic directory entry for their next
 * segment.
 */
export function listSnackFiles(
    state: SnackState,
    basePath: string,
): Array<{ name: string; type: 'file' | 'directory'; path: string }> {
    const base = normalisePath(basePath);
    const prefix = base === '' ? '' : base + '/';

    const seen = new Set<string>();
    const results: Array<{ name: string; type: 'file' | 'directory'; path: string }> = [];

    for (const [filePath, entry] of Object.entries(state.files)) {
        // Skip deleted entries.
        if (entry === null) continue;

        // Must start with the prefix (or be at root when prefix is empty).
        if (!filePath.startsWith(prefix)) continue;

        const rest = filePath.slice(prefix.length);
        if (rest === '') continue; // the base path itself

        const slashIdx = rest.indexOf('/');
        if (slashIdx === -1) {
            // Direct child file.
            if (!seen.has(rest)) {
                seen.add(rest);
                results.push({ name: rest, type: 'file', path: filePath });
            }
        } else {
            // Child belongs to a sub-directory.
            const dirName = rest.slice(0, slashIdx);
            const dirPath = prefix + dirName;
            if (!seen.has(dirName)) {
                seen.add(dirName);
                results.push({ name: dirName, type: 'directory', path: dirPath });
            }
        }
    }

    // Sort: directories first, then alphabetically.
    results.sort((a, b) => {
        if (a.type !== b.type) return a.type === 'directory' ? -1 : 1;
        return a.name.localeCompare(b.name);
    });

    return results;
}

/**
 * Delete a file from the Snack instance by setting its entry to `null`.
 */
export function deleteSnackFile(snack: SnackInstance, path: string): void {
    const norm = normalisePath(path);
    snack.updateFiles({ [norm]: null });
}

/**
 * Rename (move) a file by copying its contents to `newPath` and deleting the
 * old entry.
 */
export function renameSnackFile(snack: SnackInstance, oldPath: string, newPath: string): void {
    const normOld = normalisePath(oldPath);
    const normNew = normalisePath(newPath);

    const state = snack.getState();
    const entry = state.files[normOld];

    if (!entry) return; // Nothing to rename.

    snack.updateFiles({
        [normOld]: null,
        [normNew]: { type: 'CODE', contents: entry.contents },
    });
}

/**
 * Build a nested tree representation of a flat file map.
 *
 * Each node has `name`, `type`, `path` and an optional `children` array for
 * directories. The tree is sorted with directories before files and names in
 * alphabetical order within each group.
 */
export function snackFilesToTree(
    files: Record<string, SnackFile>,
): Array<{ name: string; type: 'file' | 'directory'; path: string; children?: any[] }> {
    type TreeNode = {
        name: string;
        type: 'file' | 'directory';
        path: string;
        children?: TreeNode[];
    };

    // Internal map keyed by directory path -> TreeNode.
    const dirNodes = new Map<string, TreeNode>();

    function ensureDir(dirPath: string): TreeNode {
        if (dirNodes.has(dirPath)) return dirNodes.get(dirPath)!;

        const parts = dirPath.split('/');
        const name = parts[parts.length - 1]!;
        const node: TreeNode = { name, type: 'directory', path: dirPath, children: [] };
        dirNodes.set(dirPath, node);

        if (parts.length > 1) {
            const parentPath = parts.slice(0, -1).join('/');
            const parent = ensureDir(parentPath);
            parent.children!.push(node);
        }

        return node;
    }

    const roots: TreeNode[] = [];

    for (const [filePath, entry] of Object.entries(files)) {
        if (!entry) continue;

        const parts = filePath.split('/');
        const fileName = parts[parts.length - 1]!;
        const fileNode: TreeNode = { name: fileName, type: 'file', path: filePath };

        if (parts.length === 1) {
            // Root-level file.
            roots.push(fileNode);
        } else {
            const parentPath = parts.slice(0, -1).join('/');
            const parent = ensureDir(parentPath);
            parent.children!.push(fileNode);
        }
    }

    // Collect root-level directories.
    for (const [dirPath, node] of dirNodes) {
        if (!dirPath.includes('/')) {
            roots.push(node);
        }
    }

    // Recursive sort helper.
    function sortChildren(nodes: TreeNode[]): void {
        nodes.sort((a, b) => {
            if (a.type !== b.type) return a.type === 'directory' ? -1 : 1;
            return a.name.localeCompare(b.name);
        });
        for (const n of nodes) {
            if (n.children) sortChildren(n.children);
        }
    }

    sortChildren(roots);
    return roots;
}

/**
 * Download (extract) the contents of specified files from the Snack state.
 *
 * Returns a `Map<string, string>` mapping each requested path to its contents.
 * Paths that do not exist or are deleted are silently skipped.
 */
export function downloadSnackFiles(state: SnackState, paths: string[]): Map<string, string> {
    const result = new Map<string, string>();
    for (const p of paths) {
        const norm = normalisePath(p);
        const entry = state.files[norm];
        if (entry && entry.type === 'CODE') {
            result.set(norm, entry.contents);
        }
    }
    return result;
}

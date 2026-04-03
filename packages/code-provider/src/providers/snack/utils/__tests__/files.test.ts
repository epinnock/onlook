import { describe, expect, it } from 'bun:test';
import {
    deleteSnackFile,
    downloadSnackFiles,
    listSnackFiles,
    readSnackFile,
    renameSnackFile,
    snackFilesToTree,
    writeSnackFile,
} from '../files';
import type { SnackFile, SnackInstance, SnackState } from '../files';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a minimal SnackState from a record of path -> contents. */
function makeState(entries: Record<string, string>): SnackState {
    const files: Record<string, SnackFile | null> = {};
    for (const [path, contents] of Object.entries(entries)) {
        files[path] = { type: 'CODE', contents };
    }
    return { files };
}

/** Build a mock SnackInstance backed by a plain object. */
function makeInstance(initial: Record<string, string> = {}): SnackInstance & { state: SnackState } {
    const state: SnackState = makeState(initial);
    return {
        state,
        getState() {
            return state;
        },
        updateFiles(patch) {
            for (const [path, entry] of Object.entries(patch)) {
                if (entry === null) {
                    state.files[path] = null;
                } else {
                    state.files[path] = entry;
                }
            }
        },
    };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('readSnackFile', () => {
    it('returns contents for an existing file', () => {
        const state = makeState({ 'App.tsx': 'export default () => null;' });
        expect(readSnackFile(state, 'App.tsx')).toBe('export default () => null;');
    });

    it('returns null for a missing file', () => {
        const state = makeState({});
        expect(readSnackFile(state, 'missing.ts')).toBeNull();
    });

    it('returns null for a deleted (null) entry', () => {
        const state: SnackState = { files: { 'deleted.ts': null } };
        expect(readSnackFile(state, 'deleted.ts')).toBeNull();
    });

    it('normalises leading/trailing slashes', () => {
        const state = makeState({ 'src/index.ts': 'hello' });
        expect(readSnackFile(state, '/src/index.ts/')).toBe('hello');
    });
});

describe('writeSnackFile', () => {
    it('creates a new file entry', () => {
        const inst = makeInstance();
        writeSnackFile(inst, 'newfile.ts', 'content');
        expect(inst.state.files['newfile.ts']).toEqual({ type: 'CODE', contents: 'content' });
    });

    it('overwrites an existing file', () => {
        const inst = makeInstance({ 'app.ts': 'old' });
        writeSnackFile(inst, 'app.ts', 'new');
        expect(inst.state.files['app.ts']).toEqual({ type: 'CODE', contents: 'new' });
    });
});

describe('listSnackFiles', () => {
    const state = makeState({
        'App.tsx': 'root file',
        'src/index.ts': 'source index',
        'src/utils/helpers.ts': 'helpers',
        'src/utils/format.ts': 'format',
        'assets/logo.png': 'png',
    });

    it('lists root-level children', () => {
        const items = listSnackFiles(state, '');
        const names = items.map((i) => i.name);
        expect(names).toContain('App.tsx');
        expect(names).toContain('src');
        expect(names).toContain('assets');
    });

    it('returns directories before files, both sorted alphabetically', () => {
        const items = listSnackFiles(state, '');
        const types = items.map((i) => i.type);
        // All directories come first.
        const firstFileIdx = types.indexOf('file');
        const lastDirIdx = types.lastIndexOf('directory');
        expect(lastDirIdx).toBeLessThan(firstFileIdx);
    });

    it('lists children of a subdirectory', () => {
        const items = listSnackFiles(state, 'src');
        expect(items).toEqual([
            { name: 'utils', type: 'directory', path: 'src/utils' },
            { name: 'index.ts', type: 'file', path: 'src/index.ts' },
        ]);
    });

    it('skips deleted entries', () => {
        const s: SnackState = {
            files: {
                'a.ts': { type: 'CODE', contents: 'a' },
                'b.ts': null,
            },
        };
        const items = listSnackFiles(s, '');
        expect(items.map((i) => i.name)).toEqual(['a.ts']);
    });
});

describe('deleteSnackFile', () => {
    it('sets the entry to null', () => {
        const inst = makeInstance({ 'remove.ts': 'bye' });
        deleteSnackFile(inst, 'remove.ts');
        expect(inst.state.files['remove.ts']).toBeNull();
    });
});

describe('renameSnackFile', () => {
    it('copies contents to new path and deletes old path', () => {
        const inst = makeInstance({ 'old.ts': 'data' });
        renameSnackFile(inst, 'old.ts', 'new.ts');
        expect(inst.state.files['old.ts']).toBeNull();
        expect(inst.state.files['new.ts']).toEqual({ type: 'CODE', contents: 'data' });
    });

    it('does nothing when the source file does not exist', () => {
        const inst = makeInstance({});
        renameSnackFile(inst, 'ghost.ts', 'target.ts');
        expect(inst.state.files['target.ts']).toBeUndefined();
    });
});

describe('snackFilesToTree', () => {
    it('builds a nested tree from a flat map', () => {
        const files: Record<string, SnackFile> = {
            'App.tsx': { type: 'CODE', contents: '' },
            'src/index.ts': { type: 'CODE', contents: '' },
            'src/utils/a.ts': { type: 'CODE', contents: '' },
        };
        const tree = snackFilesToTree(files);

        // Root should contain directory "src" then file "App.tsx".
        expect(tree[0]!.name).toBe('src');
        expect(tree[0]!.type).toBe('directory');
        expect(tree[1]!.name).toBe('App.tsx');
        expect(tree[1]!.type).toBe('file');

        // src should contain directory "utils" then file "index.ts".
        const srcChildren = tree[0]!.children!;
        expect(srcChildren[0]!.name).toBe('utils');
        expect(srcChildren[1]!.name).toBe('index.ts');
    });

    it('returns an empty array for an empty map', () => {
        expect(snackFilesToTree({})).toEqual([]);
    });
});

describe('downloadSnackFiles', () => {
    it('returns contents for requested paths', () => {
        const state = makeState({ 'a.ts': 'aaa', 'b.ts': 'bbb', 'c.ts': 'ccc' });
        const result = downloadSnackFiles(state, ['a.ts', 'c.ts']);
        expect(result.size).toBe(2);
        expect(result.get('a.ts')).toBe('aaa');
        expect(result.get('c.ts')).toBe('ccc');
    });

    it('skips missing or deleted files', () => {
        const state: SnackState = {
            files: {
                'exists.ts': { type: 'CODE', contents: 'yes' },
                'deleted.ts': null,
            },
        };
        const result = downloadSnackFiles(state, ['exists.ts', 'deleted.ts', 'missing.ts']);
        expect(result.size).toBe(1);
        expect(result.get('exists.ts')).toBe('yes');
    });
});

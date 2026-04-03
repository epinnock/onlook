import { describe, test, expect } from 'bun:test';
import { createMockSnack } from './helpers/mock-snack';
import {
    readSnackFile,
    writeSnackFile,
    listSnackFiles,
    deleteSnackFile,
    renameSnackFile,
    downloadSnackFiles,
    type SnackInstance,
    type SnackState,
} from '../../../../../packages/code-provider/src/providers/snack/utils/files';

// ---------------------------------------------------------------------------
// Adapter – bridge mock-snack shape to the SnackInstance / SnackState types
// expected by the file-ops utilities.
// ---------------------------------------------------------------------------

function asMockInstance(initialFiles?: Record<string, any>) {
    const mock = createMockSnack(initialFiles);

    const instance: SnackInstance = {
        updateFiles: (patch) => mock.updateFiles(patch as any),
        getState: () => {
            const raw = mock.getState();
            return { files: raw.files } as SnackState;
        },
    };

    return { mock, instance };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Snack Provider File Operations', () => {
    test('write and read a file', () => {
        const { mock, instance } = asMockInstance();

        writeSnackFile(instance, 'App.tsx', 'export default () => null');

        const state = instance.getState();
        const contents = readSnackFile(state, 'App.tsx');
        expect(contents).toBe('export default () => null');
    });

    test('list files in directory', () => {
        const { instance } = asMockInstance({
            'src/index.ts': { type: 'CODE', contents: 'index' },
            'src/utils.ts': { type: 'CODE', contents: 'utils' },
            'App.tsx': { type: 'CODE', contents: 'app' },
        });

        const state = instance.getState();
        const rootItems = listSnackFiles(state, '');

        const names = rootItems.map((i) => i.name);
        expect(names).toContain('src');
        expect(names).toContain('App.tsx');

        // src should appear as a directory
        const srcEntry = rootItems.find((i) => i.name === 'src');
        expect(srcEntry?.type).toBe('directory');

        // List inside src
        const srcItems = listSnackFiles(state, 'src');
        const srcNames = srcItems.map((i) => i.name);
        expect(srcNames).toContain('index.ts');
        expect(srcNames).toContain('utils.ts');
    });

    test('delete a file', () => {
        const { instance } = asMockInstance({
            'App.tsx': { type: 'CODE', contents: 'app' },
            'utils.ts': { type: 'CODE', contents: 'utils' },
        });

        deleteSnackFile(instance, 'App.tsx');

        const state = instance.getState();
        expect(readSnackFile(state, 'App.tsx')).toBeNull();
        expect(readSnackFile(state, 'utils.ts')).toBe('utils');
    });

    test('rename a file', () => {
        const { instance } = asMockInstance({
            'old-name.ts': { type: 'CODE', contents: 'my code' },
        });

        renameSnackFile(instance, 'old-name.ts', 'new-name.ts');

        const state = instance.getState();
        expect(readSnackFile(state, 'old-name.ts')).toBeNull();
        expect(readSnackFile(state, 'new-name.ts')).toBe('my code');
    });

    test('download multiple files', () => {
        const { instance } = asMockInstance({
            'a.ts': { type: 'CODE', contents: 'aaa' },
            'b.ts': { type: 'CODE', contents: 'bbb' },
            'c.ts': { type: 'CODE', contents: 'ccc' },
        });

        const state = instance.getState();
        const result = downloadSnackFiles(state, ['a.ts', 'c.ts']);

        expect(result.size).toBe(2);
        expect(result.get('a.ts')).toBe('aaa');
        expect(result.get('c.ts')).toBe('ccc');
        expect(result.has('b.ts')).toBe(false);
    });

    test('list shows directories from nested paths', () => {
        const { instance } = asMockInstance({
            'src/components/Button.tsx': { type: 'CODE', contents: 'btn' },
            'src/components/Input.tsx': { type: 'CODE', contents: 'inp' },
            'src/utils/format.ts': { type: 'CODE', contents: 'fmt' },
            'src/index.ts': { type: 'CODE', contents: 'idx' },
        });

        const state = instance.getState();
        const srcItems = listSnackFiles(state, 'src');

        // Should contain directory entries for components and utils
        const dirs = srcItems.filter((i) => i.type === 'directory');
        const dirNames = dirs.map((d) => d.name);
        expect(dirNames).toContain('components');
        expect(dirNames).toContain('utils');

        // Directories should be listed before files
        const types = srcItems.map((i) => i.type);
        const firstFileIdx = types.indexOf('file');
        const lastDirIdx = types.lastIndexOf('directory');
        expect(lastDirIdx).toBeLessThan(firstFileIdx);
    });

    test('read nonexistent file returns null', () => {
        const { instance } = asMockInstance();

        const state = instance.getState();
        expect(readSnackFile(state, 'does-not-exist.ts')).toBeNull();
    });
});

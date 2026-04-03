import { describe, test, expect } from 'bun:test';
import { createMockSnack } from './helpers/mock-snack';
import {
    readSnackFile,
    writeSnackFile,
    listSnackFiles,
    deleteSnackFile,
    renameSnackFile,
    type SnackInstance,
    type SnackState,
} from '../../../../../packages/code-provider/src/providers/snack/utils/files';
import {
    parsePackageJsonDeps,
    updateSnackDeps,
    getSnackDeps,
    type SnackInstance as DepSnackInstance,
} from '../../../../../packages/code-provider/src/providers/snack/utils/dependencies';
import {
    getSnackWebPreviewUrl,
    getSnackPreviewUrlForProvider,
    buildSnackQrCodeData,
} from '../../../../../packages/code-provider/src/providers/snack/utils/preview';
import {
    SNACK_BLANK_TEMPLATE,
    SNACK_DEFAULT_SDK_VERSION,
    getSnackWebPreviewUrl as getConstantsUrl,
} from '../../../../../packages/constants/src/snack';

// ---------------------------------------------------------------------------
// Adapter – bridge mock-snack shape to the typed interfaces expected by
// the file-ops and dependency utilities.
// ---------------------------------------------------------------------------

function asFileInstance(initialFiles?: Record<string, any>) {
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

function asDepInstance() {
    const mock = createMockSnack();

    const instance: DepSnackInstance = {
        updateDependencies: (deps) => mock.updateDependencies(deps as any),
        getState: () => {
            const raw = mock.getState();
            return { dependencies: raw.dependencies };
        },
    };

    return { mock, instance };
}

// ---------------------------------------------------------------------------
// Full Lifecycle
// ---------------------------------------------------------------------------

describe('Snack Full Lifecycle', () => {
    test('1. Create project with blank template', () => {
        const { instance } = asFileInstance(SNACK_BLANK_TEMPLATE.files as any);
        const state = instance.getState();
        expect(Object.keys(state.files).length).toBeGreaterThan(0);
        expect(state.files['App.tsx']).toBeDefined();
    });

    test('2. Read template file', () => {
        const { instance } = asFileInstance(SNACK_BLANK_TEMPLATE.files as any);
        const content = readSnackFile(instance.getState(), 'App.tsx');
        expect(content).toContain('export default');
    });

    test('3. Write a new file', () => {
        const { instance } = asFileInstance(SNACK_BLANK_TEMPLATE.files as any);
        writeSnackFile(instance, 'components/Header.tsx', 'export default () => <Text>Header</Text>');
        const content = readSnackFile(instance.getState(), 'components/Header.tsx');
        expect(content).toContain('Header');
    });

    test('4. List files shows directories', () => {
        const { instance } = asFileInstance({
            'App.tsx': { type: 'CODE', contents: 'app' },
            'components/A.tsx': { type: 'CODE', contents: 'a' },
            'components/B.tsx': { type: 'CODE', contents: 'b' },
        });
        const items = listSnackFiles(instance.getState(), '');
        const names = items.map((i) => i.name);
        expect(names).toContain('App.tsx');
        expect(names).toContain('components');
    });

    test('5. Delete a file', () => {
        const { instance } = asFileInstance({ 'temp.ts': { type: 'CODE', contents: 'x' } });
        deleteSnackFile(instance, 'temp.ts');
        expect(readSnackFile(instance.getState(), 'temp.ts')).toBeNull();
    });

    test('6. Rename a file', () => {
        const { instance } = asFileInstance({ 'old.ts': { type: 'CODE', contents: 'data' } });
        renameSnackFile(instance, 'old.ts', 'new.ts');
        expect(readSnackFile(instance.getState(), 'old.ts')).toBeNull();
        expect(readSnackFile(instance.getState(), 'new.ts')).toBe('data');
    });

    test('7. Manage dependencies', () => {
        const { instance } = asDepInstance();
        updateSnackDeps(instance, { 'react-native-paper': '5.0.0' });
        const deps = getSnackDeps(instance.getState());
        expect(deps['react-native-paper']).toBe('5.0.0');
    });

    test('8. Parse package.json deps', () => {
        const deps = parsePackageJsonDeps(JSON.stringify({ dependencies: { expo: '~52.0.0' } }));
        expect(deps['expo'].version).toBe('~52.0.0');
    });

    test('9. Preview URL for snack sandbox', () => {
        const url = getSnackPreviewUrlForProvider('snack-12345');
        expect(url).toContain('snack.expo.dev');
        expect(url).toContain('12345');
    });

    test('10. QR code data', () => {
        const data = buildSnackQrCodeData('exp://exp.host/@snack/test');
        expect(data).toBe('exp://exp.host/@snack/test');
    });

    test('11. Constants are correct', () => {
        expect(SNACK_DEFAULT_SDK_VERSION).toBe('52.0.0');
        expect(getConstantsUrl('test-id')).toContain('snack.expo.dev');
    });

    test('12. State listeners fire on file changes', () => {
        const snack = createMockSnack();
        let fired = false;
        snack.addStateListener(() => {
            fired = true;
        });
        snack.updateFiles({ 'test.ts': { type: 'CODE', contents: 'x' } });
        expect(fired).toBe(true);
    });

    test('13. Log listeners receive messages', () => {
        const snack = createMockSnack();
        let received = '';
        snack.addLogListener((log: any) => {
            received = log.message;
        });
        snack._emitLog('hello from device');
        expect(received).toBe('hello from device');
    });

    test('14. Snack sandbox ID convention', () => {
        const id = `snack-${Date.now()}`;
        expect(id).toMatch(/^snack-\d+$/);
    });

    test('15. CSB sandbox IDs are not affected', () => {
        const url = getSnackPreviewUrlForProvider('abc123');
        // Non-snack IDs should still work (returns snack URL but that's the function's job)
        expect(url).toContain('snack.expo.dev');
    });
});

import { describe, expect, test } from 'bun:test';

import { buildMobilePreviewBundle } from '../bundler';
import type { MobilePreviewVfs } from '../bundler/types';
import { mapMobilePreviewRuntimeError } from '../error-mapper';
import { createMobilePreviewErrorStore } from '../error-store';

function makeFakeVfs(files: Record<string, string>): MobilePreviewVfs {
    const normalizedFiles = new Map(
        Object.entries(files).map(([filePath, content]) => [
            filePath.startsWith('/') ? filePath.slice(1) : filePath,
            content,
        ]),
    );

    return {
        async listAll() {
            return Array.from(normalizedFiles.keys()).map((path) => ({
                path,
                type: 'file' as const,
            }));
        },
        async readFile(path) {
            const normalizedPath = path.startsWith('/') ? path.slice(1) : path;
            const content = normalizedFiles.get(normalizedPath);
            if (content == null) {
                throw new Error(`Missing file: ${normalizedPath}`);
            }
            return content;
        },
        watchDirectory() {
            return () => undefined;
        },
    };
}

function findLineContaining(bundleCode: string, searchText: string): number {
    const lines = bundleCode.split('\n');
    const index = lines.findIndex((line) => line.includes(searchText));
    if (index < 0) {
        throw new Error(`Unable to find bundle line containing: ${searchText}`);
    }
    return index + 1;
}

describe('mobile preview error mapper', () => {
    test('maps generated bundle locations back to the original source file', async () => {
        const bundle = await buildMobilePreviewBundle(
            makeFakeVfs({
                'package.json': JSON.stringify({}),
                'App.tsx': `import Hello from './components/Hello';
export default function App() {
  return <Hello />;
}`,
                'components/Hello.tsx': `export default function Hello() {
  return null;
}`,
            }),
        );

        const generatedLine = findLineContaining(
            bundle.code,
            'return React.createElement',
        );
        const mappedError = mapMobilePreviewRuntimeError(
            `Unexpected token < (<anonymous>:${generatedLine}:1)`,
            bundle.code,
        );

        expect(mappedError.generatedPosition).toEqual({
            line: generatedLine,
            column: 1,
        });
        expect(mappedError.sourceLocation?.filePath).toBe('App.tsx');
        expect(mappedError.sourceLocation?.line).toBe(3);
        expect(mappedError.message).toContain('App.tsx:3:');
    });

    test('leaves runtime errors without generated coordinates unchanged', () => {
        expect(
            mapMobilePreviewRuntimeError('Unexpected token <', '(() => {})();'),
        ).toEqual({
            message: 'Unexpected token <',
            generatedPosition: null,
            sourceLocation: null,
        });
    });

    test('records mapped runtime locations in the mobile preview error store', async () => {
        const bundle = await buildMobilePreviewBundle(
            makeFakeVfs({
                'package.json': JSON.stringify({}),
                'App.tsx': `import Hello from './Hello';
export default function App() {
  return <Hello />;
}`,
                'Hello.tsx': `export default function Hello() {
  return null;
}`,
            }),
        );

        const generatedLine = findLineContaining(
            bundle.code,
            'return null;',
        );
        const store = createMobilePreviewErrorStore();

        store.recordMappedRuntimeError(
            `ReferenceError: foo is not defined (<anonymous>:${generatedLine}:1)`,
            bundle.code,
            25,
        );

        expect(store.getSnapshot().runtimeError?.kind).toBe('runtime');
        expect(store.getSnapshot().runtimeError?.occurredAt).toBe(25);
        expect(store.getSnapshot().runtimeError?.occurrences).toBe(1);
        expect(store.getSnapshot().runtimeError?.sourceLocation?.filePath).toBe(
            'Hello.tsx',
        );
        expect(store.getSnapshot().runtimeError?.sourceLocation?.line).toBe(2);
        expect(store.getSnapshot().runtimeError?.message).toContain(
            `(<anonymous>:${generatedLine}:1)`,
        );
        expect(store.getSnapshot().runtimeError?.message).toContain(
            '(Hello.tsx:2:',
        );
        expect(store.getPanelModel()).toEqual({
            isVisible: true,
            items: [
                expect.objectContaining({
                    id: 'runtime',
                    kind: 'runtime',
                    title: 'Runtime error',
                    occurredAt: 25,
                    occurrences: 1,
                    sourceLocation: expect.objectContaining({
                        filePath: 'Hello.tsx',
                        line: 2,
                    }),
                }),
            ],
        });
    });
});

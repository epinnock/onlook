import { describe, expect, test } from 'bun:test';

import { buildMobilePreviewBundle } from '../bundler';
import { buildModuleCode } from '../bundler/module-code';
import { readInlineSourceMap } from '../bundler/source-map';
import type { MobilePreviewVfs } from '../bundler/types';

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

describe('buildModuleCode source maps', () => {
    test('appends an inline source map for transpiled modules', () => {
        const moduleCode = buildModuleCode(
            'src/App.tsx',
            `
                import Hello from './Hello';

                export default function App() {
                    return <Hello />;
                }
            `,
            new Map([
                [
                    'src/Hello.tsx',
                    'export default function Hello() { return null; }',
                ],
            ]),
        );

        const sourceMap = readInlineSourceMap(moduleCode);

        expect(sourceMap).not.toBeNull();
        expect(sourceMap?.file).toBe('src/App.tsx');
        expect(sourceMap?.sources).toEqual(['src/App.tsx']);
        expect(sourceMap?.sourcesContent?.[0]).toContain(
            'export default function App()',
        );
        expect(moduleCode).toContain("require('src/Hello.tsx')");
    });
});

describe('buildMobilePreviewBundle source maps', () => {
    test('preserves inline module source maps inside the wrapped bundle', async () => {
        const bundle = await buildMobilePreviewBundle(
            makeFakeVfs({
                'package.json': JSON.stringify({ main: 'App.tsx' }),
                'App.tsx': `
                    import Hello from './components/Hello';

                    export default function App() {
                        return <Hello />;
                    }
                `,
                'components/Hello.tsx': `
                    export default function Hello() {
                        return null;
                    }
                `,
            }),
        );

        const inlineSourceMaps = Array.from(
            bundle.code.matchAll(
                /\/\/# sourceMappingURL=data:application\/json(?:;charset=[^;]+)?;base64,([A-Za-z0-9+/=]+)/g,
            ),
            (match) => readInlineSourceMap(`\n${match[0]}`),
        );

        expect(inlineSourceMaps).toHaveLength(2);
        expect(inlineSourceMaps).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    file: 'App.tsx',
                    sources: ['App.tsx'],
                }),
                expect.objectContaining({
                    file: 'components/Hello.tsx',
                    sources: ['components/Hello.tsx'],
                }),
            ]),
        );
    });
});

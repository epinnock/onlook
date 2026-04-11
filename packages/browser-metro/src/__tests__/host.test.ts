import { describe, expect, it } from 'bun:test';
import { BrowserMetro } from '../host';
import type { BundleResult, Vfs } from '../host/types';

function makeFakeVfs(files: Record<string, string>): Vfs {
    return {
        async listAll() {
            return Object.keys(files).map((path) => ({
                path: path.startsWith('/') ? path : `/${path}`,
                type: 'file' as const,
            }));
        },
        async readFile(path: string) {
            const key = path.startsWith('/') ? path.slice(1) : path;
            const content = files[key];
            if (content === undefined) {
                throw new Error(`fake vfs: missing ${path}`);
            }
            return content;
        },
    };
}

describe('BrowserMetro', () => {
    it('bundles a single TSX file', async () => {
        const metro = new BrowserMetro({
            vfs: makeFakeVfs({
                'App.tsx': "export default function App() { return <div>hi</div>; }",
            }),
            esmUrl: 'https://esm.sh',
        });
        const result = await metro.bundle();
        expect(Object.keys(result.modules)).toEqual(['App.tsx']);
        expect(result.entry).toBe('App.tsx');
        expect(result.modules['App.tsx']?.code).toContain('App');
        // JSX should be transformed
        expect(result.modules['App.tsx']?.code).not.toContain('<div>');
        metro.dispose();
    });

    it('extracts bare imports as deps', async () => {
        const metro = new BrowserMetro({
            vfs: makeFakeVfs({
                'App.tsx': `
                    import { View, Text } from 'react-native';
                    import Button from 'react-native-paper';
                    import { useState } from 'react';
                    import { local } from './local';
                    export default function App() { return null; }
                `,
            }),
            esmUrl: 'https://esm.sh',
        });
        const result = await metro.bundle();
        const deps = result.modules['App.tsx']?.deps ?? [];
        expect(deps).toContain('react-native');
        expect(deps).toContain('react-native-paper');
        expect(deps).toContain('react');
        expect(deps).not.toContain('./local');
        metro.dispose();
    });

    it('picks the entry from a list of candidates', async () => {
        const metro = new BrowserMetro({
            vfs: makeFakeVfs({
                'helper.ts': 'export const x = 1;',
                'src/App.tsx': 'export default function App() { return null; }',
            }),
            esmUrl: 'https://esm.sh',
        });
        const result = await metro.bundle();
        expect(result.entry).toBe('src/App.tsx');
        metro.dispose();
    });

    it('onUpdate fires after bundle', async () => {
        const metro = new BrowserMetro({
            vfs: makeFakeVfs({
                'App.tsx': "export default function App() { return null; }",
            }),
            esmUrl: 'https://esm.sh',
        });
        let fired = 0;
        metro.onUpdate(() => {
            fired++;
        });
        await metro.bundle();
        expect(fired).toBe(1);
        await metro.invalidate();
        expect(fired).toBe(2);
        metro.dispose();
    });

    it('reports BundleError with file context on transpile failure', async () => {
        const metro = new BrowserMetro({
            vfs: makeFakeVfs({
                // Must be a recognized entry filename so the strict resolver
                // (TR2.2) doesn't short-circuit before we hit the transpiler.
                'App.tsx': 'export default function broken() { return <div',
            }),
            esmUrl: 'https://esm.sh',
        });
        await expect(metro.bundle()).rejects.toThrow(/App\.tsx/);
        metro.dispose();
    });

    it('invalidate() re-reads the Vfs and republishes a fresh bundle (TR4.1)', async () => {
        // Mutable in-memory file map so we can change content between bundles.
        const files: Record<string, string> = {
            'App.tsx': 'module.exports = "v1";',
        };
        const vfs: Vfs = {
            async listAll() {
                return Object.keys(files).map((path) => ({
                    path: path.startsWith('/') ? path : `/${path}`,
                    type: 'file' as const,
                }));
            },
            async readFile(path: string) {
                const key = path.startsWith('/') ? path.slice(1) : path;
                const content = files[key];
                if (content === undefined) {
                    throw new Error(`fake vfs: missing ${path}`);
                }
                return content;
            },
        };

        const metro = new BrowserMetro({ vfs, esmUrl: 'https://esm.sh' });
        const received: BundleResult[] = [];
        metro.onUpdate((result) => {
            received.push(result);
        });

        // First bundle — should see "v1".
        await metro.bundle();
        expect(received).toHaveLength(1);
        const first = received[0]!;
        expect(first.modules['App.tsx']).toBeDefined();
        expect(first.modules['App.tsx']?.code).toContain('"v1"');

        // Mutate the in-memory Vfs.
        files['App.tsx'] = 'module.exports = "v2";';

        // invalidate() should re-walk the Vfs (NOT use a cached read) and
        // publish a second bundle with the new content.
        await metro.invalidate();
        expect(received).toHaveLength(2);
        const second = received[1]!;
        expect(second.modules['App.tsx']?.code).toContain('"v2"');
        expect(second.modules['App.tsx']?.code).not.toContain('"v1"');

        // The second result must carry the TR2.5 fields.
        expect(typeof second.iife).toBe('string');
        expect(second.iife.length).toBeGreaterThan(0);
        expect(typeof second.importmap).toBe('string');
        expect(() => JSON.parse(second.importmap)).not.toThrow();
        expect(Array.isArray(second.bareImports)).toBe(true);

        metro.dispose();
    });

    it('wires file-walker + entry-resolver + bare-import-rewriter + iife-wrapper (R2 roundtrip)', async () => {
        const metro = new BrowserMetro({
            vfs: makeFakeVfs({
                'App.tsx': `
                    import { useState } from 'react';
                    import { Hello } from './components/Hello';
                    export default function App() {
                        const [n] = useState(0);
                        return <Hello count={n} />;
                    }
                `,
                'components/Hello.tsx': `
                    export function Hello(props: { count: number }) {
                        return <span>{props.count}</span>;
                    }
                `,
                'index.tsx': `
                    import App from './App';
                    export default App;
                `,
            }),
            esmUrl: 'https://esm.sh',
        });
        const result = await metro.bundle();

        // All three files landed in the module map.
        expect(Object.keys(result.modules).sort()).toEqual([
            'App.tsx',
            'components/Hello.tsx',
            'index.tsx',
        ]);

        // Entry resolver prefers index.tsx over App.tsx (TR2.2 default order).
        expect(result.entry).toBe('index.tsx');

        // IIFE wrapper produced a self-contained async script (FOUND-06b).
        expect(result.iife.startsWith(';(async function(')).toBe(true);
        expect(result.iife).toContain('__modules');
        expect(result.iife).toContain('index.tsx');

        // The single bare import ('react') is collected and deduped.
        expect(result.bareImports).toContain('react');

        // Importmap is valid JSON and routes 'react' to the ESM CDN.
        const importmap = JSON.parse(result.importmap) as {
            imports: Record<string, string>;
        };
        expect(importmap.imports.react).toBeDefined();
        expect(importmap.imports.react).toContain('react');

        metro.dispose();
    });
});

import { describe, expect, test } from 'bun:test';
import { walkVfs } from '../file-walker';
import type { Vfs } from '../types';

function makeVfs(files: Record<string, string | Uint8Array>): Vfs {
    return {
        async listAll() {
            const dirs = new Set<string>();
            for (const path of Object.keys(files)) {
                const parts = path.split('/');
                for (let i = 1; i < parts.length; i++) {
                    dirs.add(parts.slice(0, i).join('/'));
                }
            }
            return [
                ...[...dirs].map((d) => ({ path: d, type: 'directory' as const })),
                ...Object.keys(files).map((p) => ({ path: p, type: 'file' as const })),
            ];
        },
        async readFile(path: string) {
            const v = files[path];
            if (v == null) throw new Error(`not found: ${path}`);
            return v;
        },
    };
}

describe('walkVfs', () => {
    test('empty Vfs returns []', async () => {
        const vfs = makeVfs({});
        const result = await walkVfs(vfs);
        expect(result).toEqual([]);
    });

    test('filters non-source extensions (App.tsx kept, package.json dropped)', async () => {
        const vfs = makeVfs({
            'App.tsx': 'export default function App() { return null; }',
            'package.json': '{"name":"x"}',
        });
        const result = await walkVfs(vfs);
        expect(result).toHaveLength(1);
        expect(result[0]?.path).toBe('App.tsx');
        expect(result[0]?.content).toBe('export default function App() { return null; }');
    });

    test('excludes node_modules by default', async () => {
        const vfs = makeVfs({
            'App.tsx': 'app',
            'node_modules/foo/bar.tsx': 'should-be-excluded',
        });
        const result = await walkVfs(vfs);
        expect(result).toHaveLength(1);
        expect(result[0]?.path).toBe('App.tsx');
    });

    test('includes nested source files and sorts by path', async () => {
        const vfs = makeVfs({
            'src/components/Hello.tsx': 'hello',
            'src/App.tsx': 'app',
        });
        const result = await walkVfs(vfs);
        expect(result).toHaveLength(2);
        expect(result.map((f) => f.path)).toEqual([
            'src/App.tsx',
            'src/components/Hello.tsx',
        ]);
    });

    test('decodes Uint8Array file content', async () => {
        const bytes = new TextEncoder().encode('export const x = 42;');
        const vfs = makeVfs({
            'App.tsx': bytes,
        });
        const result = await walkVfs(vfs);
        expect(result).toHaveLength(1);
        expect(result[0]?.content).toBe('export const x = 42;');
    });

    test('custom excludes drops a fixtures/ directory', async () => {
        const vfs = makeVfs({
            'src/App.tsx': 'app',
            'fixtures/sample.tsx': 'fixture',
        });
        const result = await walkVfs(vfs, { excludes: ['fixtures'] });
        expect(result).toHaveLength(1);
        expect(result[0]?.path).toBe('src/App.tsx');
    });

    test('custom extensions: only .ts matches (not .tsx)', async () => {
        const vfs = makeVfs({
            'a.ts': 'ts',
            'b.tsx': 'tsx',
        });
        const result = await walkVfs(vfs, { extensions: ['.ts'] });
        expect(result).toHaveLength(1);
        expect(result[0]?.path).toBe('a.ts');
    });

    test('strips leading slash from paths', async () => {
        // Some Vfs implementations prefix with '/'. Simulate by using a custom Vfs.
        const vfs: Vfs = {
            async listAll() {
                return [{ path: '/App.tsx', type: 'file' as const }];
            },
            async readFile(path: string) {
                if (path === 'App.tsx' || path === '/App.tsx') return 'app';
                throw new Error(`not found: ${path}`);
            },
        };
        const result = await walkVfs(vfs);
        expect(result).toHaveLength(1);
        expect(result[0]?.path).toBe('App.tsx');
    });
});

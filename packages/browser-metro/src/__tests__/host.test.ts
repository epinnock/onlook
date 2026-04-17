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

    it('uses a local iframe shim for expo-status-bar', async () => {
        const metro = new BrowserMetro({
            vfs: makeFakeVfs({
                'App.tsx': `
                    import { StatusBar } from 'expo-status-bar';
                    export default function App() { return <StatusBar style="light" />; }
                `,
            }),
            esmUrl: 'https://esm.sh',
        });

        const result = await metro.bundle();

        expect(result.modules['App.tsx']?.deps).toContain('expo-status-bar');
        expect(result.modules['App.tsx']?.code).toContain(
            '/__browser_metro_shims__/expo-status-bar.js',
        );
        expect(result.modules['__browser_metro_shims__/expo-status-bar.js']?.code).toContain(
            'function StatusBar()',
        );
        expect(result.iife).not.toContain('https://esm.sh/expo-status-bar?bundle');
        metro.dispose();
    });

    it('uses a local react-native iframe shim with patched Switch events', async () => {
        const metro = new BrowserMetro({
            vfs: makeFakeVfs({
                'App.tsx': `
                    import { Switch, View } from 'react-native';
                    export default function App() {
                        return <View><Switch value={false} onValueChange={() => undefined} /></View>;
                    }
                `,
            }),
            esmUrl: 'https://esm.sh',
        });

        const result = await metro.bundle();
        const appCode = result.modules['App.tsx']?.code ?? '';
        const shimCode =
            result.modules['__browser_metro_shims__/react-native.js']?.code ?? '';

        expect(result.modules['App.tsx']?.deps).toContain('react-native');
        expect(appCode).toContain('/__browser_metro_shims__/react-native.js');
        expect(appCode).not.toContain('https://esm.sh/react-native-web?bundle');
        expect(shimCode).toContain('OnlookBrowserMetroSwitch');
        expect(shimCode).toContain("role: 'switch'");
        expect(shimCode).toContain('onValueChange(nextValue)');
        expect(shimCode).toContain('https://esm.sh/react-native-web?bundle');
        expect(result.iife).toContain('https://esm.sh/react-native-web?bundle');
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

    // ------------------------------------------------------------------
    // MC4.13 — jsx-source wiring for onlook-client target
    // ------------------------------------------------------------------

    it('onlook-client target injects __source metadata into JSX in dev mode (MC4.13)', async () => {
        const metro = new BrowserMetro({
            vfs: makeFakeVfs({
                'App.tsx': "export default function App() { return <div>hi</div>; }",
            }),
            esmUrl: 'https://esm.sh',
            target: 'onlook-client',
            isDev: true,
        });
        const result = await metro.bundle();
        const code = result.modules['App.tsx']?.code ?? '';
        // __source metadata should be present
        expect(code).toContain('__source');
        expect(code).toContain('fileName');
        expect(code).toContain('lineNumber');
        expect(code).toContain('columnNumber');
        // Classic runtime: React.createElement, not jsx()
        expect(code).toContain('React.createElement');
        // JSX should be transformed (no raw angle brackets)
        expect(code).not.toContain('<div>');
        metro.dispose();
    });

    it('onlook-client target with isDev=false does NOT inject __source (MC4.13)', async () => {
        const metro = new BrowserMetro({
            vfs: makeFakeVfs({
                'App.tsx': "export default function App() { return <div>hi</div>; }",
            }),
            esmUrl: 'https://esm.sh',
            target: 'onlook-client',
            isDev: false,
        });
        const result = await metro.bundle();
        const code = result.modules['App.tsx']?.code ?? '';
        // No __source in production mode
        expect(code).not.toContain('__source');
        // JSX should still be transformed
        expect(code).not.toContain('<div>');
        metro.dispose();
    });

    it('expo-go target does NOT inject __source even in dev mode (MC4.13)', async () => {
        const metro = new BrowserMetro({
            vfs: makeFakeVfs({
                'App.tsx': "export default function App() { return <div>hi</div>; }",
            }),
            esmUrl: 'https://esm.sh',
            target: 'expo-go',
            isDev: true,
        });
        const result = await metro.bundle();
        const code = result.modules['App.tsx']?.code ?? '';
        // expo-go target should NOT have __source
        expect(code).not.toContain('__source');
        // Uses automatic runtime (jsx/jsxDEV), not classic
        expect(code).not.toContain('React.createElement');
        metro.dispose();
    });

    it('default target (no option) behaves like expo-go (MC4.13)', async () => {
        const metro = new BrowserMetro({
            vfs: makeFakeVfs({
                'App.tsx': "export default function App() { return <div>hi</div>; }",
            }),
            esmUrl: 'https://esm.sh',
        });
        const result = await metro.bundle();
        const code = result.modules['App.tsx']?.code ?? '';
        // Default should NOT inject __source
        expect(code).not.toContain('__source');
        metro.dispose();
    });

    it('onlook-client target preserves bare import rewriting (MC4.13)', async () => {
        const metro = new BrowserMetro({
            vfs: makeFakeVfs({
                'App.tsx': `
                    import React from 'react';
                    export default function App() { return <div>hi</div>; }
                `,
            }),
            esmUrl: 'https://esm.sh',
            target: 'onlook-client',
            isDev: true,
        });
        const result = await metro.bundle();
        // Bare import 'react' should still be collected
        expect(result.bareImports).toContain('react');
        // Module code should have __source
        const code = result.modules['App.tsx']?.code ?? '';
        expect(code).toContain('__source');
        metro.dispose();
    });

    it('onlook-client target produces valid IIFE with __source (MC4.13)', async () => {
        const metro = new BrowserMetro({
            vfs: makeFakeVfs({
                'App.tsx': `
                    export default function App() {
                        return <div><span>hello</span></div>;
                    }
                `,
            }),
            esmUrl: 'https://esm.sh',
            target: 'onlook-client',
            isDev: true,
        });
        const result = await metro.bundle();
        // IIFE should contain __source metadata
        expect(result.iife).toContain('__source');
        // IIFE wrapper should still be self-contained
        expect(result.iife.startsWith(';(async function(')).toBe(true);
        expect(result.iife).toContain('__modules');
        metro.dispose();
    });

    // ------------------------------------------------------------------
    // MC6.4 — React version guard wired into bundle()
    // ------------------------------------------------------------------

    it('bundle(projectDependencies) with matching React + reconciler succeeds (MC6.4)', async () => {
        const metro = new BrowserMetro({
            vfs: makeFakeVfs({
                'App.tsx': 'export default function App() { return null; }',
            }),
            esmUrl: 'https://esm.sh',
        });
        const result = await metro.bundle({
            projectDependencies: {
                react: '19.1.0',
                'react-reconciler': '0.32.0',
            },
        });
        expect(result.entry).toBe('App.tsx');
        metro.dispose();
    });

    it('bundle(projectDependencies) with wrong React version throws BundleError (MC6.4)', async () => {
        const metro = new BrowserMetro({
            vfs: makeFakeVfs({
                'App.tsx': 'export default function App() { return null; }',
            }),
            esmUrl: 'https://esm.sh',
        });
        await expect(
            metro.bundle({
                projectDependencies: {
                    react: '18.2.0',
                    'react-reconciler': '0.32.0',
                },
            }),
        ).rejects.toThrow(/React version guard failed/);
        metro.dispose();
    });

    it('bundle() without projectDependencies skips the guard (back-compat, MC6.4)', async () => {
        const metro = new BrowserMetro({
            vfs: makeFakeVfs({
                'App.tsx': 'export default function App() { return null; }',
            }),
            esmUrl: 'https://esm.sh',
        });
        // No projectDependencies option — should succeed regardless of what
        // the surrounding project's package.json says.
        const result = await metro.bundle();
        expect(result.entry).toBe('App.tsx');
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

import { describe, expect, test } from 'bun:test';
import { wrapAsIIFE, type IIFEModule } from '../iife-wrapper';

/**
 * Evaluate a wrapped IIFE in an isolated scope and return a capture object
 * populated with whatever the IIFE stashed on globalThis. We use a
 * `new Function` sandbox with a fresh fake `globalThis` so that tests do
 * not pollute the real one.
 */
function evalIIFE(code: string): { captured: Record<string, unknown>; error?: Error } {
    const captured: Record<string, unknown> = {};
    // We expose `capture` to the transpiled code via a host injection; the
    // test modules simply call `capture.foo = ...` from inside their code.
    try {
        // eslint-disable-next-line @typescript-eslint/no-implied-eval
        const fn = new Function('capture', code);
        fn(captured);
    } catch (err) {
        return { captured, error: err instanceof Error ? err : new Error(String(err)) };
    }
    return { captured };
}

describe('wrapAsIIFE', () => {
    test('1. single-module bundle evaluates and sets module.exports', () => {
        const modules: IIFEModule[] = [
            {
                path: 'App.tsx',
                code: `module.exports = "hello"; capture.entryExports = module.exports;`,
            },
        ];
        const { code } = wrapAsIIFE({ entry: 'App.tsx', modules });
        expect(code).toContain('"App.tsx"');
        expect(code).toContain('function(module, exports, require)');
        const { captured, error } = evalIIFE(code);
        expect(error).toBeUndefined();
        expect(captured.entryExports).toBe('hello');
    });

    test('2. multi-module: entry requires sibling module', () => {
        const modules: IIFEModule[] = [
            {
                path: 'App.tsx',
                code: `var Hello = require('./Hello');
module.exports = { greet: Hello.greet() };
capture.entryExports = module.exports;`,
            },
            {
                path: 'Hello.tsx',
                code: `module.exports = { greet: function() { return 'hi from Hello'; } };`,
            },
        ];
        const { code } = wrapAsIIFE({ entry: 'App.tsx', modules });
        const { captured, error } = evalIIFE(code);
        expect(error).toBeUndefined();
        expect(captured.entryExports).toEqual({ greet: 'hi from Hello' });
    });

    test('3. relative import from nested directory resolves correctly', () => {
        const modules: IIFEModule[] = [
            {
                path: 'src/App.tsx',
                code: `var Hello = require('./components/Hello');
module.exports = Hello.name;
capture.entryExports = module.exports;`,
            },
            {
                path: 'src/components/Hello.tsx',
                code: `module.exports = { name: 'nested-hello' };`,
            },
        ];
        const { code } = wrapAsIIFE({ entry: 'src/App.tsx', modules });
        const { captured, error } = evalIIFE(code);
        expect(error).toBeUndefined();
        expect(captured.entryExports).toBe('nested-hello');
    });

    test('4. extension-less import resolves via .tsx fallback', () => {
        const modules: IIFEModule[] = [
            {
                path: 'App.tsx',
                code: `var H = require('./Hello');
capture.entryExports = H.v;`,
            },
            {
                path: 'Hello.tsx',
                code: `module.exports = { v: 42 };`,
            },
        ];
        const { code } = wrapAsIIFE({ entry: 'App.tsx', modules });
        const { captured, error } = evalIIFE(code);
        expect(error).toBeUndefined();
        expect(captured.entryExports).toBe(42);
    });

    test('4b. extension-less import resolves via .ts fallback when only .ts exists', () => {
        const modules: IIFEModule[] = [
            {
                path: 'App.tsx',
                code: `var U = require('./util');
capture.entryExports = U.kind;`,
            },
            {
                path: 'util.ts',
                code: `module.exports = { kind: 'ts-only' };`,
            },
        ];
        const { code } = wrapAsIIFE({ entry: 'App.tsx', modules });
        const { captured, error } = evalIIFE(code);
        expect(error).toBeUndefined();
        expect(captured.entryExports).toBe('ts-only');
    });

    test('5. missing module throws a clear error', () => {
        const modules: IIFEModule[] = [
            {
                path: 'App.tsx',
                code: `require('./Missing');`,
            },
        ];
        const { code } = wrapAsIIFE({ entry: 'App.tsx', modules });
        const { error } = evalIIFE(code);
        expect(error).toBeDefined();
        expect(error?.message).toContain('Module not found');
        expect(error?.message).toContain('./Missing');
    });

    test('5b. bare import reaching require throws distinctive error', () => {
        const modules: IIFEModule[] = [
            {
                path: 'App.tsx',
                code: `require('react');`,
            },
        ];
        const { code } = wrapAsIIFE({ entry: 'App.tsx', modules });
        const { error } = evalIIFE(code);
        expect(error).toBeDefined();
        expect(error?.message).toContain('Bare import');
    });

    test('6. importmap contains rewritten bare imports pointing at esm.sh', () => {
        const { importmap } = wrapAsIIFE({
            entry: 'App.tsx',
            modules: [{ path: 'App.tsx', code: 'module.exports = 1;' }],
            bareImports: ['react', 'react-native-web'],
            esmUrl: 'https://esm.sh',
        });
        const parsed: { imports: Record<string, string> } = JSON.parse(importmap);
        expect(parsed.imports).toBeDefined();
        expect(parsed.imports.react).toBe(
            'https://esm.sh/react?bundle&external=react,react-dom,react-native,react-native-web',
        );
        expect(parsed.imports['react-native-web']).toBe(
            'https://esm.sh/react-native-web?bundle&external=react,react-dom,react-native,react-native-web',
        );
    });

    test('7. empty bareImports produces an empty importmap', () => {
        const { importmap } = wrapAsIIFE({
            entry: 'App.tsx',
            modules: [{ path: 'App.tsx', code: 'module.exports = 1;' }],
            bareImports: [],
        });
        expect(importmap).toBe('{"imports":{}}');
    });

    test('8. entry not in modules throws synchronously', () => {
        expect(() =>
            wrapAsIIFE({
                entry: 'Missing.tsx',
                modules: [{ path: 'App.tsx', code: 'module.exports = 1;' }],
            }),
        ).toThrow(/entry 'Missing.tsx'/);
    });

    test('9. output code is wrapped as an IIFE', () => {
        const { code } = wrapAsIIFE({
            entry: 'App.tsx',
            modules: [{ path: 'App.tsx', code: 'module.exports = 1;' }],
        });
        expect(code.startsWith(';(function()')).toBe(true);
        expect(code.trimEnd().endsWith('})();')).toBe(true);
    });
});

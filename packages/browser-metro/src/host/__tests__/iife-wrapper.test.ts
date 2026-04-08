import { describe, expect, test } from 'bun:test';
import { wrapAsIIFE, type IIFEModule } from '../iife-wrapper';

/**
 * Evaluate a wrapped IIFE in an isolated scope and return a capture object
 * populated with whatever the IIFE stashed on the injected `capture` value.
 *
 * The wrapper now emits an **async** IIFE, so the injected `fn` returns a
 * Promise. We await it. Any thrown error inside the async IIFE surfaces as a
 * rejection we catch and return.
 *
 * To keep tests hermetic the wrapper consults `globalThis.__browserMetroImport`
 * for dynamic imports. We inject a local stub so URL imports never hit the
 * network. The stub is installed/removed around each eval.
 */
interface EvalResult {
    captured: Record<string, unknown>;
    error?: Error;
}

type UrlStub = Record<string, Record<string, unknown>>;

async function evalIIFE(code: string, urlStub: UrlStub = {}): Promise<EvalResult> {
    const captured: Record<string, unknown> = {};
    const g = globalThis as unknown as {
        __browserMetroImport?: (url: string) => Promise<Record<string, unknown>>;
    };
    const prev = g.__browserMetroImport;
    g.__browserMetroImport = (url: string) => {
        if (url in urlStub) return Promise.resolve(urlStub[url]!);
        return Promise.reject(new Error(`unstubbed import(${url})`));
    };
    try {
        // The emitted `code` is the expression `;(async function(){...})();`
        // We return it from the outer Function so the caller can await the
        // promise and observe rejections from inside the async IIFE.
        // eslint-disable-next-line @typescript-eslint/no-implied-eval
        const fn = new Function('capture', `return ${code.replace(/^;/, '')}`);
        await fn(captured);
        return { captured };
    } catch (err) {
        return { captured, error: err instanceof Error ? err : new Error(String(err)) };
    } finally {
        if (prev === undefined) delete g.__browserMetroImport;
        else g.__browserMetroImport = prev;
    }
}

describe('wrapAsIIFE', () => {
    test('1. single-module bundle evaluates and sets module.exports', async () => {
        const modules: IIFEModule[] = [
            {
                path: 'App.tsx',
                code: `module.exports = "hello"; capture.entryExports = module.exports;`,
            },
        ];
        const { code } = wrapAsIIFE({ entry: 'App.tsx', modules });
        expect(code).toContain('"App.tsx"');
        expect(code).toContain('function(module, exports, require)');
        const { captured, error } = await evalIIFE(code);
        expect(error).toBeUndefined();
        expect(captured.entryExports).toBe('hello');
    });

    test('2. multi-module: entry requires sibling module', async () => {
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
        const { captured, error } = await evalIIFE(code);
        expect(error).toBeUndefined();
        expect(captured.entryExports).toEqual({ greet: 'hi from Hello' });
    });

    test('3. relative import from nested directory resolves correctly', async () => {
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
        const { captured, error } = await evalIIFE(code);
        expect(error).toBeUndefined();
        expect(captured.entryExports).toBe('nested-hello');
    });

    test('4. extension-less import resolves via .tsx fallback', async () => {
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
        const { captured, error } = await evalIIFE(code);
        expect(error).toBeUndefined();
        expect(captured.entryExports).toBe(42);
    });

    test('4b. extension-less import resolves via .ts fallback when only .ts exists', async () => {
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
        const { captured, error } = await evalIIFE(code);
        expect(error).toBeUndefined();
        expect(captured.entryExports).toBe('ts-only');
    });

    test('5. missing module throws a clear error', async () => {
        const modules: IIFEModule[] = [
            {
                path: 'App.tsx',
                code: `require('./Missing');`,
            },
        ];
        const { code } = wrapAsIIFE({ entry: 'App.tsx', modules });
        const { error } = await evalIIFE(code);
        expect(error).toBeDefined();
        expect(error?.message).toContain('Module not found');
        expect(error?.message).toContain('./Missing');
    });

    test('5b. bare import reaching require throws distinctive error', async () => {
        const modules: IIFEModule[] = [
            {
                path: 'App.tsx',
                code: `require('react');`,
            },
        ];
        const { code } = wrapAsIIFE({ entry: 'App.tsx', modules });
        const { error } = await evalIIFE(code);
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

    test('9. output code is wrapped as an async IIFE', () => {
        const { code } = wrapAsIIFE({
            entry: 'App.tsx',
            modules: [{ path: 'App.tsx', code: 'module.exports = 1;' }],
        });
        expect(code.startsWith(';(async function()')).toBe(true);
        expect(code.trimEnd().endsWith('})();')).toBe(true);
    });

    test('10. empty bareImports → IIFE runs without hitting __importer', async () => {
        const modules: IIFEModule[] = [
            {
                path: 'App.tsx',
                code: `module.exports = 'ran'; capture.ran = true;`,
            },
        ];
        const { code } = wrapAsIIFE({ entry: 'App.tsx', modules, bareImports: [] });
        // Inject a stub that WOULD throw if called — bareImports is empty so
        // the Promise.all([]) path should never invoke it.
        const { captured, error } = await evalIIFE(code, {});
        expect(error).toBeUndefined();
        expect(captured.ran).toBe(true);
    });

    test('11. single URL bareImport → IIFE awaits it and populates __urlCache', async () => {
        const url =
            'https://esm.sh/react-native-web?bundle&external=react,react-dom,react-native,react-native-web';
        const modules: IIFEModule[] = [
            {
                path: 'App.tsx',
                code: `module.exports = 'ok'; capture.ran = true;`,
            },
        ];
        const { code } = wrapAsIIFE({
            entry: 'App.tsx',
            modules,
            bareImports: [url],
        });
        // Sanity — the URL appears in the emitted runtime.
        expect(code).toContain(JSON.stringify(url));
        const { captured, error } = await evalIIFE(code, {
            [url]: { default: { pretended: 'module' } },
        });
        expect(error).toBeUndefined();
        expect(captured.ran).toBe(true);
    });

    test('12. module requiring a URL gets the ES namespace from __urlCache', async () => {
        const url = 'https://esm.sh/my-lib?bundle';
        const modules: IIFEModule[] = [
            {
                path: 'App.tsx',
                code: `var lib = require('${url}');
capture.libDefault = lib.default;
capture.libNamed = lib.named;
module.exports = lib;`,
            },
        ];
        const { code } = wrapAsIIFE({
            entry: 'App.tsx',
            modules,
            bareImports: [url],
        });
        const { captured, error } = await evalIIFE(code, {
            [url]: { default: 'the-default', named: 'the-named' },
        });
        expect(error).toBeUndefined();
        expect(captured.libDefault).toBe('the-default');
        expect(captured.libNamed).toBe('the-named');
    });

    test('13. requiring a URL that was NOT pre-fetched throws "URL not pre-fetched"', async () => {
        const url = 'https://example.com/unknown';
        const modules: IIFEModule[] = [
            {
                path: 'App.tsx',
                code: `require('${url}');`,
            },
        ];
        // Deliberately omit the URL from bareImports so it isn't pre-fetched.
        const { code } = wrapAsIIFE({
            entry: 'App.tsx',
            modules,
            bareImports: [],
        });
        const { error } = await evalIIFE(code, {});
        expect(error).toBeDefined();
        expect(error?.message).toContain('URL not pre-fetched');
        expect(error?.message).toContain(url);
    });

    test('14. multiple URL imports are all fetched in parallel and cached', async () => {
        const urlA = 'https://esm.sh/a?bundle';
        const urlB = 'https://esm.sh/b?bundle';
        const modules: IIFEModule[] = [
            {
                path: 'App.tsx',
                code: `var a = require('${urlA}');
var b = require('${urlB}');
capture.a = a.default;
capture.b = b.default;`,
            },
        ];
        const { code } = wrapAsIIFE({
            entry: 'App.tsx',
            modules,
            bareImports: [urlA, urlB],
        });
        const { captured, error } = await evalIIFE(code, {
            [urlA]: { default: 'A' },
            [urlB]: { default: 'B' },
        });
        expect(error).toBeUndefined();
        expect(captured.a).toBe('A');
        expect(captured.b).toBe('B');
    });

    test('15. URL pre-fetch failure rejects the async IIFE', async () => {
        const url = 'https://esm.sh/bad?bundle';
        const modules: IIFEModule[] = [
            {
                path: 'App.tsx',
                code: `module.exports = 1;`,
            },
        ];
        const { code } = wrapAsIIFE({
            entry: 'App.tsx',
            modules,
            bareImports: [url],
        });
        // Stub returns rejection for this URL.
        const { error } = await evalIIFE(code, {});
        expect(error).toBeDefined();
        expect(error?.message).toContain('unstubbed import');
    });

    test('16. importmap skips URL entries in bareImports (only bare-name keys)', () => {
        const url = 'https://esm.sh/react?bundle';
        const { importmap } = wrapAsIIFE({
            entry: 'App.tsx',
            modules: [{ path: 'App.tsx', code: 'module.exports = 1;' }],
            bareImports: ['react-dom', url],
            esmUrl: 'https://esm.sh',
        });
        const parsed: { imports: Record<string, string> } = JSON.parse(importmap);
        expect(parsed.imports['react-dom']).toBe(
            'https://esm.sh/react-dom?bundle&external=react,react-dom,react-native,react-native-web',
        );
        // URL keys should be skipped from the importmap (invalid as keys).
        expect(parsed.imports[url]).toBeUndefined();
    });
});

import { describe, expect, test } from 'bun:test';
import { wrapAsIIFE, type IIFEModule } from '../iife-wrapper';

/**
 * MC2.11 — Guard against the `iife-wrapper.ts` output ever emitting top-level
 * ESM `export` / `import` statements.
 *
 * Rationale (source-plan Phase 2): the onlook mobile-client runtime evaluates
 * the wrapped bundle as a plain script on Hermes. Hermes' parser rejects
 * module-level ES `export` / `import` declarations in script context with a
 * `SyntaxError`, crashing the JS context before any module body runs. The
 * wrapper already converts bare imports + Sucrase output into a self-contained
 * async IIFE that relies only on `require` / `module.exports`, but nothing
 * prevents a future edit from accidentally letting an ESM statement leak into
 * the emitted code (e.g. by switching the module-entry template from
 * `module.exports = ...` to `export default ...`). This test catches that
 * class of regression.
 *
 * The check is line-oriented: for each line of emitted `code`, we assert it
 * does NOT begin (after optional whitespace) with the keyword `export` or
 * `import` followed by a word boundary. A word boundary matters because the
 * wrapper legitimately uses identifiers that start with those sequences
 * (e.g. `exports`, `__importer`, `__urlImports`); we only care about the
 * ESM keywords themselves.
 */

const ESM_LINE_RE = /^\s*(export|import)\b/;

/** Collect every line of `code` that looks like an ESM top-level statement. */
function esmLines(code: string): string[] {
    return code.split('\n').filter((line) => ESM_LINE_RE.test(line));
}

describe('iife-wrapper: no top-level ESM export/import', () => {
    test('ESM_LINE_RE self-check: matches real ESM, ignores lookalikes', () => {
        // Positive cases — things the guard MUST catch.
        expect(ESM_LINE_RE.test('export default foo;')).toBe(true);
        expect(ESM_LINE_RE.test('export const x = 1;')).toBe(true);
        expect(ESM_LINE_RE.test('  export { bar };')).toBe(true);
        expect(ESM_LINE_RE.test('import React from "react";')).toBe(true);
        expect(ESM_LINE_RE.test('\timport "./side-effect";')).toBe(true);

        // Negative cases — must NOT false-positive on identifier prefixes,
        // comments, or property-style references.
        expect(ESM_LINE_RE.test('module.exports = {};')).toBe(false);
        expect(ESM_LINE_RE.test('exports.foo = 1;')).toBe(false);
        expect(ESM_LINE_RE.test('var exports = {};')).toBe(false);
        expect(ESM_LINE_RE.test('var __importer = foo;')).toBe(false);
        expect(ESM_LINE_RE.test('var __urlImports = [];')).toBe(false);
        expect(ESM_LINE_RE.test('// export default foo;')).toBe(false);
        expect(ESM_LINE_RE.test('/* import x from "y" */')).toBe(false);
        expect(ESM_LINE_RE.test('  // export { bar };')).toBe(false);
    });

    test('empty-ish bundle: wrapped single empty entry emits no top-level ESM', () => {
        const modules: IIFEModule[] = [
            {
                path: 'App.tsx',
                code: '',
            },
        ];
        const { code } = wrapAsIIFE({ entry: 'App.tsx', modules });

        const offenders = esmLines(code);
        expect(offenders).toEqual([]);
    });

    test('simple Metro-style bundle emits no top-level ESM', () => {
        // Representative shape of what Sucrase + the rewriter feed into the
        // wrapper: CommonJS-style bodies that use `require` / `module.exports`.
        // We deliberately use multi-line bodies (mimicking Metro's newline
        // preservation) so the line-splitting guard exercises many lines.
        const modules: IIFEModule[] = [
            {
                path: 'App.tsx',
                code: [
                    'var _react = require("https://esm.sh/react");',
                    'var _Hello = require("./components/Hello");',
                    'function App() {',
                    '  return _react.createElement(_Hello.Hello, null);',
                    '}',
                    'module.exports = App;',
                ].join('\n'),
            },
            {
                path: 'components/Hello.tsx',
                code: [
                    'var _react = require("https://esm.sh/react");',
                    'function Hello() {',
                    '  return _react.createElement("div", null, "hi");',
                    '}',
                    'exports.Hello = Hello;',
                ].join('\n'),
            },
        ];
        const { code } = wrapAsIIFE({
            entry: 'App.tsx',
            modules,
            bareImportUrls: ['https://esm.sh/react'],
        });

        // Sanity: the wrapper actually ran and produced the expected shape.
        expect(code).toContain('"App.tsx"');
        expect(code).toContain('"components/Hello.tsx"');
        expect(code).toContain('(async function()');

        const offenders = esmLines(code);
        expect(offenders).toEqual([]);
    });

    test('bundle containing stray "// export" comments is NOT flagged', () => {
        // Agents touching the wrapper sometimes leave comment markers like
        // `// export` or `// import` inside module bodies (e.g. TODO notes
        // ported from upstream packages). The regex must be word-boundary
        // aware: a comment that merely mentions the word "export" is fine,
        // because Hermes only complains about STATEMENT-position ESM.
        const modules: IIFEModule[] = [
            {
                path: 'App.tsx',
                code: [
                    '// export default foo; — original upstream, now CJS',
                    '/* import React from "react"; — rewritten above */',
                    '  // export { Hello };',
                    'var exports_table = { export: 1, import: 2 };',
                    'module.exports = exports_table;',
                ].join('\n'),
            },
        ];
        const { code } = wrapAsIIFE({ entry: 'App.tsx', modules });

        const offenders = esmLines(code);
        expect(offenders).toEqual([]);

        // The test would be vacuous if the stray comments got stripped out by
        // the wrapper, so also assert they made it through verbatim.
        expect(code).toContain('// export default foo;');
        expect(code).toContain('/* import React from "react";');
        expect(code).toContain('var exports_table');
    });

    test('sabotage check: the guard catches a hand-crafted ESM leak', () => {
        // Meta-test: confirm esmLines() would actually FAIL if the wrapper
        // ever regressed to emitting a top-level ESM statement. We don't
        // modify the wrapper — we just run the same guard on a synthetic
        // string that simulates the regression, to prove the test is not
        // vacuous.
        const synthetic = [
            ';(async function(){',
            '  var __modules = {};',
            '  export default __modules;', // <-- the kind of leak we guard against
            '})();',
        ].join('\n');

        const offenders = esmLines(synthetic);
        expect(offenders.length).toBe(1);
        expect(offenders[0]).toContain('export default');
    });
});

import { describe, expect, test } from 'bun:test';
import { transformWithJsxSource } from '../sucrase-jsx-source';

describe('transformWithJsxSource', () => {
    test('1. simple <div /> includes __source with fileName, lineNumber, columnNumber', () => {
        const { code } = transformWithJsxSource('<div />', 'test.tsx');
        expect(code).toContain('__source:');
        expect(code).toContain('fileName: _jsxFileName');
        expect(code).toContain('lineNumber: 1');
        expect(code).toContain('columnNumber: 1');
        // Verify it compiles to React.createElement
        expect(code).toContain("React.createElement('div'");
    });

    test('2. <Comp prop="val" /> preserves the prop AND adds __source', () => {
        const { code } = transformWithJsxSource('<Comp prop="val" />', 'test.tsx');
        expect(code).toContain('prop: "val"');
        expect(code).toContain('__source:');
        expect(code).toContain('lineNumber: 1');
        expect(code).toContain('columnNumber: 1');
        expect(code).toContain('React.createElement(Comp');
    });

    test('3. production mode does NOT inject __source', () => {
        const { code } = transformWithJsxSource('<div />', 'test.tsx', { isDev: false });
        expect(code).not.toContain('__source');
        expect(code).not.toContain('_jsxFileName');
        expect(code).toContain("React.createElement('div'");
    });

    test('4. nested JSX: both elements get __source with different columns on same line', () => {
        const { code } = transformWithJsxSource('<div><span /></div>', 'test.tsx');
        // Both elements should have __source
        const sourceMatches = code.match(/__source:/g);
        expect(sourceMatches).not.toBeNull();
        expect(sourceMatches!.length).toBe(2);
        // <div> starts at column 1, <span at column 6
        expect(code).toContain('lineNumber: 1, columnNumber: 1');
        expect(code).toContain('lineNumber: 1, columnNumber: 6');
    });

    test('5. multi-line nested JSX: elements get correct line numbers', () => {
        const source = '<div>\n  <span />\n</div>';
        const { code } = transformWithJsxSource(source, 'test.tsx');
        // <div> at line 1, <span> at line 2
        expect(code).toContain('lineNumber: 1, columnNumber: 1');
        expect(code).toContain('lineNumber: 2, columnNumber: 3');
    });

    test('6. fileName is embedded in the _jsxFileName variable', () => {
        const { code } = transformWithJsxSource('<div />', 'src/components/App.tsx');
        expect(code).toContain('"src/components/App.tsx"');
    });

    test('7. isDev defaults to true (omitting options still injects __source)', () => {
        const { code } = transformWithJsxSource('<div />', 'test.tsx');
        expect(code).toContain('__source:');
        expect(code).toContain('columnNumber:');
    });

    test('8. TypeScript syntax in .tsx files is handled', () => {
        const source = 'const x: number = 1;\nconst el = <div />;';
        const { code } = transformWithJsxSource(source, 'test.tsx');
        expect(code).toContain("React.createElement('div'");
        expect(code).toContain('__source:');
        // TypeScript type annotation should be stripped
        expect(code).not.toContain(': number');
    });

    test('9. .jsx files do not apply TypeScript transform', () => {
        const source = '<div className="test" />';
        const { code } = transformWithJsxSource(source, 'test.jsx');
        expect(code).toContain("React.createElement('div'");
        expect(code).toContain('className: "test"');
        expect(code).toContain('__source:');
    });

    test('10. deeply nested JSX has __source on every element', () => {
        const source = [
            '<div>',
            '  <ul>',
            '    <li>Hello</li>',
            '  </ul>',
            '</div>',
        ].join('\n');
        const { code } = transformWithJsxSource(source, 'test.tsx');
        // 3 open tags (div, ul, li) → 3 __source entries
        const sourceMatches = code.match(/__source:/g);
        expect(sourceMatches).not.toBeNull();
        expect(sourceMatches!.length).toBe(3);
        // Verify different line numbers
        expect(code).toContain('lineNumber: 1');
        expect(code).toContain('lineNumber: 2');
        expect(code).toContain('lineNumber: 3');
    });

    test('11. JSX expression with fragment-like nested elements', () => {
        const source = '<div>\n  <span>A</span>\n  <span>B</span>\n</div>';
        const { code } = transformWithJsxSource(source, 'test.tsx');
        // 3 elements total (div + 2 spans)
        const sourceMatches = code.match(/__source:/g);
        expect(sourceMatches).not.toBeNull();
        expect(sourceMatches!.length).toBe(3);
    });

    test('12. production mode with complex JSX produces clean output', () => {
        const source = '<div>\n  <Comp foo="bar">\n    <span />\n  </Comp>\n</div>';
        const { code } = transformWithJsxSource(source, 'test.tsx', { isDev: false });
        expect(code).not.toContain('__source');
        expect(code).not.toContain('__self');
        expect(code).not.toContain('_jsxFileName');
        // Elements still render
        expect(code).toContain("React.createElement('div'");
        expect(code).toContain('React.createElement(Comp');
        expect(code).toContain("React.createElement('span'");
    });
});

import { describe, expect, test } from 'bun:test';

import { injectJsxSource, createJsxSourcePlugin } from '../src/plugins/jsx-source';

describe('injectJsxSource', () => {
    test('injects __source on a simple JSX element', () => {
        const src = 'const x = <View>hi</View>;';
        const out = injectJsxSource(src, { filename: '/App.tsx' });
        expect(out).toContain('__source={{fileName: "/App.tsx", lineNumber: 1, columnNumber:');
    });

    test('injects __source on a self-closing element', () => {
        const src = '<Icon name="x" />';
        const out = injectJsxSource(src, { filename: '/A.tsx' });
        expect(out).toContain('__source=');
        expect(out).toContain('/>');
    });

    test('skips elements that already have __source (skipExisting=true default)', () => {
        const src = '<View __source={{fileName: "orig", lineNumber: 1, columnNumber: 0}} />';
        const out = injectJsxSource(src, { filename: '/other.tsx' });
        // Should not add a second __source.
        expect(out).toBe(src);
    });

    test('computes line + column for multi-line sources', () => {
        const src = '\n\n\n    <View />';
        const out = injectJsxSource(src, { filename: '/x.tsx' });
        expect(out).toContain('lineNumber: 4');
        expect(out).toContain('columnNumber: 4');
    });

    test('preserves existing attributes', () => {
        const src = '<Button onPress={handler} style={s}>Go</Button>';
        const out = injectJsxSource(src, { filename: '/b.tsx' });
        expect(out).toContain('onPress={handler}');
        expect(out).toContain('style={s}');
        expect(out).toContain('__source={{');
    });

    test('injects for both uppercase components AND lowercase host components', () => {
        const src = '<view /><Text />';
        const out = injectJsxSource(src, { filename: '/x.tsx' });
        // Two injections expected.
        expect(out.match(/__source=/g)?.length).toBe(2);
    });
});

describe('createJsxSourcePlugin', () => {
    test('returns an esbuild plugin shape with name + setup', () => {
        const plugin = createJsxSourcePlugin({});
        expect(plugin.name).toBe('onlook-jsx-source');
        expect(typeof plugin.setup).toBe('function');
    });

    test('setup invokes build.onLoad without throwing', () => {
        const plugin = createJsxSourcePlugin({});
        const calls: unknown[] = [];
        plugin.setup({
            onLoad: (filter, handler) => {
                calls.push({ filter, handler });
            },
        });
        expect(calls).toHaveLength(1);
    });
});

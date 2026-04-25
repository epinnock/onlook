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
            onLoad: (filter: { filter: RegExp; namespace?: string }, handler: unknown) => {
                calls.push({ filter, handler });
            },
        });
        expect(calls).toHaveLength(1);
    });
});

// ─── End-to-end plugin wiring (task #34 / #84) ──────────────────────────────
function runPluginOnLoad(
    plugin: ReturnType<typeof createJsxSourcePlugin>,
    args: { path: string; namespace?: string; suffix?: string },
) {
    let captured:
        | ((a: { path: string; namespace?: string; suffix?: string }) =>
              | { contents: string; loader: 'tsx' | 'jsx' }
              | undefined
              | void)
        | undefined;
    plugin.setup({
        onLoad: (_options, handler: unknown) => {
            captured = handler as typeof captured;
        },
    });
    if (captured === undefined) throw new Error('plugin did not register onLoad');
    return captured(args);
}

describe('createJsxSourcePlugin — end-to-end onLoad', () => {
    test('transforms virtual .tsx files with injected __source', () => {
        const plugin = createJsxSourcePlugin({
            files: { 'src/App.tsx': 'const x = <View>hi</View>;' },
        });
        const result = runPluginOnLoad(plugin, { path: 'src/App.tsx' }) as
            | { contents: string; loader: 'tsx' | 'jsx' }
            | undefined;
        expect(result).not.toBeUndefined();
        expect(result!.loader).toBe('tsx');
        expect(result!.contents).toContain('__source=');
        expect(result!.contents).toContain('"src/App.tsx"');
    });

    test('picks loader: "jsx" for .jsx files', () => {
        const plugin = createJsxSourcePlugin({
            files: { 'src/App.jsx': '<Root />' },
        });
        const result = runPluginOnLoad(plugin, { path: 'src/App.jsx' }) as
            | { contents: string; loader: 'tsx' | 'jsx' }
            | undefined;
        expect(result?.loader).toBe('jsx');
    });

    test('returns undefined when the file is not in the virtual map', () => {
        const plugin = createJsxSourcePlugin({
            files: { 'src/A.tsx': '<A/>' },
        });
        const result = runPluginOnLoad(plugin, { path: 'src/missing.tsx' });
        expect(result).toBeUndefined();
    });

    test('returns undefined when plugin has no files map (downstream picks it up)', () => {
        const plugin = createJsxSourcePlugin({});
        const result = runPluginOnLoad(plugin, { path: 'src/App.tsx' });
        expect(result).toBeUndefined();
    });

    test('decodes Uint8Array contents as UTF-8 before transforming', () => {
        const src = new TextEncoder().encode('<View />');
        const plugin = createJsxSourcePlugin({
            files: { 'src/A.tsx': src },
        });
        const result = runPluginOnLoad(plugin, { path: 'src/A.tsx' }) as
            | { contents: string; loader: 'tsx' | 'jsx' }
            | undefined;
        expect(result?.contents).toContain('__source=');
    });

    test('honors custom filenameFor override', () => {
        const plugin = createJsxSourcePlugin({
            files: { '/abs/src/App.tsx': '<View/>' },
            filenameFor: (path) => path.replace(/^\/abs\//, ''),
        });
        const result = runPluginOnLoad(plugin, { path: '/abs/src/App.tsx' }) as
            | { contents: string; loader: 'tsx' | 'jsx' }
            | undefined;
        expect(result?.contents).toContain('"src/App.tsx"');
    });

    test('path normalization: backslash + leading slash resolve to same virtual entry', () => {
        const plugin = createJsxSourcePlugin({
            files: { 'src/App.tsx': '<View/>' },
        });
        const a = runPluginOnLoad(plugin, { path: '\\src\\App.tsx' });
        const b = runPluginOnLoad(plugin, { path: '/src/App.tsx' });
        expect(a).not.toBeUndefined();
        expect(b).not.toBeUndefined();
    });
});

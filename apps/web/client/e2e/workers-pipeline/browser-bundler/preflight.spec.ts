import { expect, test } from '@playwright/test';

import {
    assertNoUnsupportedImports,
    preflightUnsupportedImports,
} from '../../../../../../packages/browser-bundler/src/preflight';

import { DEFAULT_BASE_EXTERNALS } from '../helpers/browser-bundler-harness';

test.describe('workers-pipeline browser-bundler — preflight', () => {
    test('flags an unsupported bare import before bundling', () => {
        const issues = preflightUnsupportedImports({
            files: {
                '/App.tsx': [
                    "import { noop } from 'lodash';",
                    "export default function App() { noop(); return null; }",
                ].join('\n'),
            },
            externalSpecifiers: DEFAULT_BASE_EXTERNALS,
        });

        expect(issues).toHaveLength(1);
        expect(issues[0]?.specifier).toBe('lodash');
        expect(issues[0]?.filePath).toBe('/App.tsx');
        expect(issues[0]?.message).toContain('Unsupported bare import "lodash"');
    });

    test('allows externals that are part of the base bundle registry', () => {
        const issues = preflightUnsupportedImports({
            files: {
                '/App.tsx': [
                    "import { View } from 'react-native';",
                    "import { StatusBar } from 'expo-status-bar';",
                    "export default function App() { return <View><StatusBar /></View>; }",
                ].join('\n'),
            },
            externalSpecifiers: DEFAULT_BASE_EXTERNALS,
        });

        expect(issues).toEqual([]);
    });

    test('allows relative imports regardless of registry contents', () => {
        const issues = preflightUnsupportedImports({
            files: {
                '/App.tsx': "import Thing from './components/Thing';",
                '/components/Thing.tsx': "export default function Thing() { return null; }",
            },
            externalSpecifiers: [],
        });

        expect(issues).toEqual([]);
    });

    test('assertNoUnsupportedImports throws with a clear multi-issue message', () => {
        expect(() =>
            assertNoUnsupportedImports({
                files: {
                    '/App.tsx': "import 'lodash'; import 'moment';",
                },
                externalSpecifiers: DEFAULT_BASE_EXTERNALS,
            }),
        ).toThrow(/Unsupported imports found:[\s\S]*lodash[\s\S]*moment/);
    });

    test('deduplicates repeated offenders so the error list stays short', () => {
        const issues = preflightUnsupportedImports({
            files: {
                '/A.tsx': [
                    "import 'lodash';",
                    "import 'lodash';",
                ].join('\n'),
            },
            externalSpecifiers: [],
        });

        expect(issues).toHaveLength(1);
        expect(issues[0]?.specifier).toBe('lodash');
    });
});

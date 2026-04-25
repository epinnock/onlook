import { describe, expect, test } from 'bun:test';

import {
    assertNoUnsupportedImports,
    assertAbiV1Imports,
    preflightUnsupportedImports,
    preflightAbiV1Imports,
} from '../src/preflight';

describe('unsupported import preflight', () => {
    test('allows supported external imports', () => {
        const issues = preflightUnsupportedImports({
            files: {
                'src/App.tsx': "import React from 'react';",
            },
            externalSpecifiers: ['react'],
        });

        expect(issues).toEqual([]);
    });

    test('allows local imports', () => {
        const issues = preflightUnsupportedImports({
            files: {
                'src/App.tsx': "import './styles.css';\nconst helper = require('./helper');",
            },
            externalSpecifiers: ['react'],
        });

        expect(issues).toEqual([]);
    });

    test('reports unsupported bare imports', () => {
        const issues = preflightUnsupportedImports({
            files: {
                'src/App.tsx': "import lodash from 'lodash';",
            },
            externalSpecifiers: ['react'],
        });

        expect(issues).toEqual([
            {
                filePath: 'src/App.tsx',
                specifier: 'lodash',
                message:
                    'Unsupported bare import "lodash" in src/App.tsx. Add it to the base bundle or rewrite it as a local import.',
            },
        ]);
    });

    test('reports unsupported imports across multiple files', () => {
        const issues = preflightUnsupportedImports({
            files: {
                'src/App.tsx': "import React from 'react';\nimport leftPad from 'left-pad';",
                'src/utils.ts': "const yaml = require('yaml');\nconst local = require('./local');",
            },
            externalSpecifiers: ['react'],
        });

        expect(issues).toEqual([
            {
                filePath: 'src/App.tsx',
                specifier: 'left-pad',
                message:
                    'Unsupported bare import "left-pad" in src/App.tsx. Add it to the base bundle or rewrite it as a local import.',
            },
            {
                filePath: 'src/utils.ts',
                specifier: 'yaml',
                message:
                    'Unsupported bare import "yaml" in src/utils.ts. Add it to the base bundle or rewrite it as a local import.',
            },
        ]);
    });

    test('throws an aggregate error when assertions fail', () => {
        expect(() =>
            assertNoUnsupportedImports({
                files: {
                    'src/App.tsx': "import lodash from 'lodash';",
                },
                externalSpecifiers: ['react'],
            }),
        ).toThrow('Unsupported imports found');
    });
});

// ─── ABI v1 preflight — task #44 ─────────────────────────────────────────────

describe('ABI v1 preflight', () => {
    test('passes when every bare import is in the baseAliases set', () => {
        expect(
            preflightAbiV1Imports({
                files: {
                    'src/App.tsx':
                        "import React from 'react';\nimport { View } from 'react-native';",
                },
                baseAliases: ['react', 'react-native'],
            }),
        ).toEqual([]);
    });

    test('flags a disallowed native specifier with kind:unsupported-native', () => {
        const issues = preflightAbiV1Imports({
            files: {
                'src/App.tsx':
                    "import Animated from 'react-native-reanimated';",
            },
            baseAliases: ['react', 'react-native'],
            disallowed: ['react-native-reanimated', '@shopify/react-native-skia'],
        });
        expect(issues).toHaveLength(1);
        expect(issues[0]?.kind).toBe('unsupported-native');
        expect(issues[0]?.specifier).toBe('react-native-reanimated');
        expect(issues[0]?.message).toContain('native');
    });

    test('flags unknown bare imports with kind:unknown-specifier', () => {
        const issues = preflightAbiV1Imports({
            files: {
                'src/App.tsx': "import lodash from 'lodash';",
            },
            baseAliases: ['react', 'react-native'],
        });
        expect(issues).toHaveLength(1);
        expect(issues[0]?.kind).toBe('unknown-specifier');
        expect(issues[0]?.specifier).toBe('lodash');
    });

    test('disallowed takes precedence over baseAliases (policy safety net)', () => {
        // Even if a disallowed native module was mistakenly added to baseAliases,
        // the policy still rejects it.
        const issues = preflightAbiV1Imports({
            files: {
                'src/App.tsx': "import Animated from 'react-native-reanimated';",
            },
            baseAliases: ['react-native-reanimated'],
            disallowed: ['react-native-reanimated'],
        });
        expect(issues).toHaveLength(1);
        expect(issues[0]?.kind).toBe('unsupported-native');
    });

    test('ignores relative, absolute, URL, and node: specifiers', () => {
        const issues = preflightAbiV1Imports({
            files: {
                'src/App.tsx': [
                    "import './styles.css';",
                    "import x from '../util';",
                    "import y from '/abs/path';",
                    "import z from 'https://cdn.example.com/mod.js';",
                    "import q from 'node:fs';",
                ].join('\n'),
            },
            baseAliases: [],
        });
        // node:fs IS technically a bare-looking specifier BUT the scheme check
        // excludes it. Relative/absolute/URL are also excluded.
        expect(issues.filter((i) => i.kind === 'unknown-specifier').map((i) => i.specifier)).toEqual([]);
    });

    test('reports per-(file,specifier,kind) triple only once', () => {
        const issues = preflightAbiV1Imports({
            files: {
                'src/App.tsx': "import a from 'lodash';\nimport b from 'lodash';",
            },
            baseAliases: ['react'],
        });
        expect(issues).toHaveLength(1);
    });

    test('assertAbiV1Imports throws with a multi-line error summary', () => {
        expect(() =>
            assertAbiV1Imports({
                files: {
                    'src/App.tsx':
                        "import Animated from 'react-native-reanimated';\nimport lodash from 'lodash';",
                },
                baseAliases: ['react', 'react-native'],
                disallowed: ['react-native-reanimated'],
            }),
        ).toThrow(/ABI v1 preflight rejected overlay[\s\S]*unsupported-native[\s\S]*unknown-specifier/);
    });
});

import { describe, expect, test } from 'bun:test';

import {
    assertNoUnsupportedImports,
    preflightUnsupportedImports,
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

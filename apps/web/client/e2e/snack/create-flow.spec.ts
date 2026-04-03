import { describe, test, expect, mock, beforeEach, afterEach } from 'bun:test';
import { createMockSnack } from './helpers/mock-snack';
import {
    getSnackWebPreviewUrl,
    getSnackExpoGoUrl,
    getSnackPreviewUrlForProvider,
} from '../../../../../packages/code-provider/src/providers/snack/utils/preview';
import { parsePackageJsonDeps } from '../../../../../packages/code-provider/src/providers/snack/utils/dependencies';
import {
    fetchGitHubRepoAsSnackFiles,
    parseGitHubUrl,
} from '../../../../../packages/code-provider/src/providers/snack/utils/github';

// ---------------------------------------------------------------------------
// Constants used in assertions
// ---------------------------------------------------------------------------

const SNACK_SANDBOX_PREFIX = 'snack-';
const SNACK_EMBEDDED_BASE = 'https://snack.expo.dev/embedded/@snack';

/** Minimal blank-template file set that a Snack project requires. */
const BLANK_TEMPLATE_FILES: Record<string, { type: 'CODE'; contents: string }> = {
    'App.tsx': {
        type: 'CODE',
        contents: [
            "import React from 'react';",
            "import { Text, View, StyleSheet } from 'react-native';",
            '',
            'export default function App() {',
            '  return (',
            '    <View style={styles.container}>',
            '      <Text>Hello, Scry!</Text>',
            '    </View>',
            '  );',
            '}',
            '',
            'const styles = StyleSheet.create({',
            '  container: { flex: 1, alignItems: \'center\', justifyContent: \'center\' },',
            '});',
        ].join('\n'),
    },
    'package.json': {
        type: 'CODE',
        contents: JSON.stringify(
            {
                name: 'scry-blank',
                dependencies: {
                    react: '18.2.0',
                    'react-native': '0.73.0',
                    expo: '~51.0.0',
                },
            },
            null,
            2,
        ),
    },
};

const BLANK_TEMPLATE_DEPS: Record<string, { version: string }> = {
    react: { version: '18.2.0' },
    'react-native': { version: '0.73.0' },
    expo: { version: '~51.0.0' },
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Snack Create Flow', () => {
    test('snack sandbox ID has correct prefix', () => {
        const snackId = 'abc123';
        const sandboxId = `${SNACK_SANDBOX_PREFIX}${snackId}`;

        expect(sandboxId.startsWith('snack-')).toBe(true);
        expect(sandboxId).toBe('snack-abc123');

        // The preview URL helper should strip the prefix correctly
        const url = getSnackPreviewUrlForProvider(sandboxId);
        expect(url).toContain(snackId);
        expect(url).not.toContain('snack-snack-');
    });

    test('blank template has required files', () => {
        const fileNames = Object.keys(BLANK_TEMPLATE_FILES);

        expect(fileNames).toContain('App.tsx');
        expect(fileNames).toContain('package.json');

        // Every file must have type CODE and non-empty contents
        for (const [path, file] of Object.entries(BLANK_TEMPLATE_FILES)) {
            expect(file.type).toBe('CODE');
            expect(file.contents.length).toBeGreaterThan(0);
        }
    });

    test('blank template has required dependencies', () => {
        expect(BLANK_TEMPLATE_DEPS).toHaveProperty('react');
        expect(BLANK_TEMPLATE_DEPS).toHaveProperty('react-native');
        expect(BLANK_TEMPLATE_DEPS).toHaveProperty('expo');

        // Each dependency must have a version string
        for (const [name, dep] of Object.entries(BLANK_TEMPLATE_DEPS)) {
            expect(typeof dep.version).toBe('string');
            expect(dep.version.length).toBeGreaterThan(0);
        }
    });

    test('web preview URL format is correct', () => {
        const snackId = 'test-snack-id';
        const url = getSnackWebPreviewUrl(snackId);

        expect(url).toBe(
            `${SNACK_EMBEDDED_BASE}/${snackId}?preview=true&platform=web`,
        );

        // URL should be parseable
        const parsed = new URL(url);
        expect(parsed.searchParams.get('preview')).toBe('true');
        expect(parsed.searchParams.get('platform')).toBe('web');
    });

    test('expo go URL is async', async () => {
        const snack = createMockSnack();
        const url = await getSnackExpoGoUrl(snack);

        expect(typeof url).toBe('string');
        expect(url).toMatch(/^exp:\/\//);
    });

    test('GitHub repo can be fetched as Snack files (mocked)', async () => {
        const originalFetch = globalThis.fetch;

        const mockFetch = mock((url: string) => {
            const urlStr = String(url);

            if (urlStr.includes('/git/trees/')) {
                return Promise.resolve({
                    ok: true,
                    json: () =>
                        Promise.resolve({
                            tree: [
                                { path: 'App.tsx', type: 'blob', sha: 'aaa' },
                                { path: 'package.json', type: 'blob', sha: 'bbb' },
                                { path: 'src/index.ts', type: 'blob', sha: 'ccc' },
                                { path: 'node_modules/react/index.js', type: 'blob', sha: 'ddd' },
                            ],
                        }),
                } as Response);
            }

            if (urlStr.includes('raw.githubusercontent.com')) {
                const path = urlStr.split('/main/')[1] ?? '';
                const contents: Record<string, string> = {
                    'App.tsx': 'export default function App() {}',
                    'package.json': '{ "name": "test-repo" }',
                    'src/index.ts': 'console.log("init");',
                };
                return Promise.resolve({
                    ok: true,
                    text: () => Promise.resolve(contents[path] ?? ''),
                } as Response);
            }

            return Promise.resolve({ ok: false, status: 404 } as Response);
        });

        globalThis.fetch = mockFetch as unknown as typeof fetch;
        try {
            const files = await fetchGitHubRepoAsSnackFiles('https://github.com/test/repo');

            // Should include code files only
            expect(Object.keys(files)).toContain('App.tsx');
            expect(Object.keys(files)).toContain('package.json');
            expect(Object.keys(files)).toContain('src/index.ts');

            // node_modules must be excluded
            expect(files['node_modules/react/index.js']).toBeUndefined();

            // Each entry must have the SnackFile shape
            for (const file of Object.values(files)) {
                expect(file.type).toBe('CODE');
                expect(typeof file.contents).toBe('string');
            }
        } finally {
            globalThis.fetch = originalFetch;
        }
    });

    test('dependency parsing from package.json', () => {
        const packageJson = JSON.stringify({
            name: 'my-expo-app',
            dependencies: {
                react: '18.2.0',
                'react-native': '0.73.0',
                expo: '~51.0.0',
            },
            devDependencies: {
                typescript: '5.5.4',
            },
        });

        const parsed = parsePackageJsonDeps(packageJson);

        // All dependencies and devDependencies should be present
        expect(parsed).toHaveProperty('react');
        expect(parsed).toHaveProperty('react-native');
        expect(parsed).toHaveProperty('expo');
        expect(parsed).toHaveProperty('typescript');

        // Each entry should have the SnackDep shape
        expect(parsed['react']).toEqual({ version: '18.2.0' });
        expect(parsed['expo']).toEqual({ version: '~51.0.0' });
        expect(parsed['typescript']).toEqual({ version: '5.5.4' });

        // Invalid JSON should return empty
        expect(parsePackageJsonDeps('not valid json')).toEqual({});
    });
});

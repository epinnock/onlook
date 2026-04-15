import { describe, expect, test } from 'bun:test';

import {
    buildMobilePreviewBundle,
    MobilePreviewBundleError,
    type MobilePreviewVfs,
} from '../index';
import {
    collectUnsupportedMobilePreviewImports,
    formatUnsupportedMobilePreviewImports,
    isMobilePreviewSupportedBareImport,
} from '../bundler/preflight';

function makeFakeVfs(files: Record<string, string>): MobilePreviewVfs {
    const normalizedFiles = new Map(
        Object.entries(files).map(([filePath, content]) => [
            filePath.startsWith('/') ? filePath.slice(1) : filePath,
            content,
        ]),
    );

    return {
        async listAll() {
            return Array.from(normalizedFiles.keys()).map((path) => ({
                path,
                type: 'file' as const,
            }));
        },
        async readFile(path) {
            const normalizedPath = path.startsWith('/') ? path.slice(1) : path;
            const content = normalizedFiles.get(normalizedPath);
            if (content == null) {
                throw new Error(`Missing file: ${normalizedPath}`);
            }
            return content;
        },
        watchDirectory() {
            return () => undefined;
        },
    };
}

describe('mobile preview unsupported-import preflight', () => {
    test('treats registry-backed shim imports as supported bare imports', () => {
        expect(isMobilePreviewSupportedBareImport('react-native-screens')).toBe(
            true,
        );
        expect(isMobilePreviewSupportedBareImport('react-native-svg')).toBe(true);
    });

    test('collects unsupported imports across the local dependency graph', () => {
        const files = new Map<string, string>([
            [
                'App.tsx',
                `
                    import supported from './supported';
                    import nested from './nested';
                    import { Button } from '@react-navigation/native';

                    export default function App() {
                        void supported;
                        void nested;
                        return null;
                    }
                `,
            ],
            [
                'supported.ts',
                `
                    import { Screen } from 'react-native-screens';

                    export { Screen };
                `,
            ],
            [
                'nested.ts',
                `
                    const storage = require('react-native-mmkv');

                    export default storage;
                `,
            ],
        ]);

        expect(collectUnsupportedMobilePreviewImports(files, 'App.tsx')).toEqual([
            {
                importerPath: 'App.tsx',
                specifier: '@react-navigation/native',
            },
            {
                importerPath: 'nested.ts',
                specifier: 'react-native-mmkv',
            },
        ]);
    });

    test('formats a clear unsupported import error message', () => {
        expect(
            formatUnsupportedMobilePreviewImports([
                {
                    importerPath: 'App.tsx',
                    specifier: '@react-navigation/native',
                },
            ]),
        ).toContain(
            'Mobile preview does not support these package imports yet:',
        );
    });

    test('rejects bundle builds with explicit unsupported import details', async () => {
        const vfs = makeFakeVfs({
            'App.tsx': `
                import './storage';

                export default function App() {
                    return null;
                }
            `,
            'storage.ts': `
                import { createJSONStorage } from 'react-native-mmkv';

                export default createJSONStorage;
            `,
        });

        await expect(buildMobilePreviewBundle(vfs)).rejects.toThrow(
            new RegExp(
                'react-native-mmkv.*storage\\.ts|storage\\.ts.*react-native-mmkv',
            ),
        );
    });

    test('allows bundle builds that rely on registry-backed runtime shims', async () => {
        const vfs = makeFakeVfs({
            'App.tsx': `
                import { Screen } from 'react-native-screens';
                import Svg from 'react-native-svg';

                export default function App() {
                    return Screen && Svg ? null : null;
                }
            `,
        });

        const bundle = await buildMobilePreviewBundle(vfs);

        expect(bundle.moduleCount).toBe(1);
        expect(bundle.code).toContain("require('react-native-screens')");
        expect(bundle.code).toContain("require('react-native-svg')");
    });

    test('throws the mobile preview bundle error type for unsupported imports', async () => {
        const vfs = makeFakeVfs({
            'App.tsx': `
                const module = require('@react-navigation/native');

                export default module;
            `,
        });

        await expect(buildMobilePreviewBundle(vfs)).rejects.toBeInstanceOf(
            MobilePreviewBundleError,
        );
    });
});

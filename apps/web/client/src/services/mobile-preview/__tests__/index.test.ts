import { describe, expect, test } from 'bun:test';
import React from 'react';
import {
    buildMobilePreviewBundle,
    MobilePreviewBundleError,
    shouldSyncMobilePreviewPath,
    type MobilePreviewVfs,
} from '../index';

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

describe('buildMobilePreviewBundle', () => {
    test('waits briefly for entry files to sync before failing the build', async () => {
        let listCalls = 0;
        const files = new Map([
            ['package.json', JSON.stringify({ main: 'App.tsx' })],
            [
                'App.tsx',
                `
                    export default function App() {
                        return null;
                    }
                `,
            ],
        ]);

        const vfs: MobilePreviewVfs = {
            async listAll() {
                listCalls += 1;
                if (listCalls < 3) {
                    return [];
                }

                return Array.from(files.keys()).map((path) => ({
                    path,
                    type: 'file' as const,
                }));
            },
            async readFile(path) {
                const content = files.get(path);
                if (content == null) {
                    throw new Error(`Missing file: ${path}`);
                }

                return content;
            },
            watchDirectory() {
                return () => undefined;
            },
        };

        const bundle = await buildMobilePreviewBundle(vfs);

        expect(bundle.entryPath).toBe('App.tsx');
        expect(listCalls).toBe(3);
    });

    test('resolves package.json main values without an explicit extension', async () => {
        const vfs = makeFakeVfs({
            'package.json': JSON.stringify({ main: 'src/App' }),
            'src/App.tsx': `
                export default function App() {
                    return null;
                }
            `,
        });

        const bundle = await buildMobilePreviewBundle(vfs);

        expect(bundle.entryPath).toBe('src/App.tsx');
        expect(bundle.moduleCount).toBe(1);
    });

    test('builds an eval bundle for a local multi-file Expo app', async () => {
        const vfs = makeFakeVfs({
            'package.json': JSON.stringify({ main: 'App.tsx' }),
            'App.tsx': `
                import { StatusBar } from 'expo-status-bar';
                import { View } from 'react-native';
                import Hello from './components/Hello';

                export default function App() {
                    return (
                        <View>
                            <StatusBar />
                            <Hello />
                        </View>
                    );
                }
            `,
            'components/Hello.tsx': `
                import { Text } from 'react-native';

                export default function Hello() {
                    return <Text>Hello from phone</Text>;
                }
            `,
        });

        const bundle = await buildMobilePreviewBundle(vfs);

        expect(bundle.entryPath).toBe('App.tsx');
        expect(bundle.moduleCount).toBe(2);
        expect(bundle.code).toContain('"components/Hello.tsx": function');
        expect(bundle.code).toContain("require('components/Hello.tsx')");
        expect(bundle.code).toContain("specifier === 'expo-status-bar'");

        const renderAppCalls: unknown[] = [];
        const runtimeGlobal = globalThis as typeof globalThis & {
            renderApp?: (element: unknown) => void;
            View?: string;
            TextC?: (props: { children?: React.ReactNode }) => React.ReactElement;
            RawText?: string;
            React?: typeof React;
        };
        const previousRenderApp = runtimeGlobal.renderApp;
        const previousReact = runtimeGlobal.React;
        const previousView = runtimeGlobal.View;
        const previousTextC = runtimeGlobal.TextC;
        const previousRawText = runtimeGlobal.RawText;

        runtimeGlobal.React = React;
        runtimeGlobal.View = 'View';
        runtimeGlobal.RawText = 'RCTRawText';
        runtimeGlobal.TextC = ({ children }) =>
            React.createElement('RCTText', null, children);
        runtimeGlobal.renderApp = (element) => {
            renderAppCalls.push(element);
        };

        try {
            (0, eval)(bundle.code);
        } finally {
            runtimeGlobal.renderApp = previousRenderApp;
            runtimeGlobal.React = previousReact;
            runtimeGlobal.View = previousView;
            runtimeGlobal.TextC = previousTextC;
            runtimeGlobal.RawText = previousRawText;
        }

        expect(renderAppCalls).toHaveLength(1);
    });

    test('throws for unsupported bare imports', async () => {
        const vfs = makeFakeVfs({
            'App.tsx': `
                import { Button } from '@react-navigation/native';

                export default function App() {
                    return <Button />;
                }
            `,
        });

        await expect(buildMobilePreviewBundle(vfs)).rejects.toBeInstanceOf(
            MobilePreviewBundleError,
        );
    });
});

describe('shouldSyncMobilePreviewPath', () => {
    test('accepts source files and package.json', () => {
        expect(shouldSyncMobilePreviewPath('/App.tsx')).toBe(true);
        expect(shouldSyncMobilePreviewPath('package.json')).toBe(true);
    });

    test('rejects ignored noise paths', () => {
        expect(shouldSyncMobilePreviewPath('/.onlook/index.json')).toBe(false);
        expect(shouldSyncMobilePreviewPath('/node_modules/react/index.js')).toBe(
            false,
        );
        expect(shouldSyncMobilePreviewPath('/bun.lock')).toBe(false);
    });
});

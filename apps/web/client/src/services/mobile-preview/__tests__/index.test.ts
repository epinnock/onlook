import { beforeEach, describe, expect, mock, test } from 'bun:test';
import React from 'react';
import type { MobilePreviewVfs } from '../index';
import type { MobilePreviewPipelineKind } from '../pipelines/types';

const mockEnv: {
    NEXT_PUBLIC_MOBILE_PREVIEW_PIPELINE?: MobilePreviewPipelineKind;
    NEXT_PUBLIC_MOBILE_PREVIEW_URL?: string;
    NEXT_PUBLIC_CF_ESM_BUILDER_URL?: string;
    NEXT_PUBLIC_CF_EXPO_RELAY_URL?: string;
} = {};

mock.module('@/env', () => ({
    env: mockEnv,
}));

const {
    buildMobilePreviewBundle,
    createMobilePreviewPipeline,
    getMobilePreviewPipelineCapabilities,
    MobilePreviewBundleError,
    resolveMobilePreviewPipelineConfig,
    shouldSyncMobilePreviewPath,
} = await import('../index');

beforeEach(() => {
    mockEnv.NEXT_PUBLIC_MOBILE_PREVIEW_PIPELINE = undefined;
    mockEnv.NEXT_PUBLIC_MOBILE_PREVIEW_URL = 'http://mobile-preview.test';
    mockEnv.NEXT_PUBLIC_CF_ESM_BUILDER_URL = 'https://builder.test';
    mockEnv.NEXT_PUBLIC_CF_EXPO_RELAY_URL = 'https://relay.test';
});

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

describe('createMobilePreviewPipeline', () => {
    test('creates the shim pipeline by default', () => {
        expect(resolveMobilePreviewPipelineConfig()).toEqual({
            kind: 'shim',
            serverBaseUrl: 'http://mobile-preview.test',
        });

        const pipeline = createMobilePreviewPipeline();

        expect(pipeline.kind).toBe('shim');
        expect(pipeline.capabilities).toEqual({
            liveUpdates: true,
            onlookDeepLink: false,
        });
    });

    test('creates the two-tier pipeline when the pipeline flag selects it', () => {
        mockEnv.NEXT_PUBLIC_MOBILE_PREVIEW_PIPELINE = 'two-tier';

        expect(resolveMobilePreviewPipelineConfig()).toEqual({
            kind: 'two-tier',
            builderBaseUrl: 'https://builder.test',
            relayBaseUrl: 'https://relay.test',
        });

        const pipeline = createMobilePreviewPipeline();

        expect(pipeline.kind).toBe('two-tier');
        expect(pipeline.capabilities).toEqual({
            liveUpdates: true,
            onlookDeepLink: true,
        });
        expect(pipeline.shouldSyncPath('/App.tsx')).toBe(true);
        expect(pipeline.shouldSyncPath('/bun.lock')).toBe(false);
    });

    test('lets explicit options override the selected pipeline', () => {
        mockEnv.NEXT_PUBLIC_MOBILE_PREVIEW_PIPELINE = 'two-tier';

        const pipeline = createMobilePreviewPipeline({
            kind: 'shim',
            serverBaseUrl: 'http://override.test',
        });

        expect(pipeline.kind).toBe('shim');
        expect(getMobilePreviewPipelineCapabilities('two-tier')).toEqual({
            liveUpdates: true,
            onlookDeepLink: true,
        });
    });

    // Phase 11b — verify the deps slot threads compatibilityProvider
    // through to the underlying TwoTier pipeline. We don't drive a full
    // sync here (no esbuild service registered); we just assert the
    // factory accepts the new shape without regression. The end-to-end
    // gate behavior is covered by two-tier.test.ts.
    test('createMobilePreviewPipeline accepts a compatibilityProvider in deps (two-tier)', () => {
        mockEnv.NEXT_PUBLIC_MOBILE_PREVIEW_PIPELINE = 'two-tier';
        let calls = 0;
        const pipeline = createMobilePreviewPipeline(
            { kind: 'two-tier', builderBaseUrl: 'b', relayBaseUrl: 'r' },
            { compatibilityProvider: () => {
                calls += 1;
                return 'ok';
            } },
        );
        expect(pipeline.kind).toBe('two-tier');
        // Provider has not been invoked yet — only sync() drives it. This
        // pins the lazy-call contract: pipeline construction must not
        // eagerly sample capabilities (the relay WS may not be open yet).
        expect(calls).toBe(0);
    });

    test('createMobilePreviewPipeline ignores compatibilityProvider on the shim branch', () => {
        // Shim has no v1 envelope to gate, so a provider passed in deps
        // must be silently dropped — not crash, not error.
        const pipeline = createMobilePreviewPipeline(
            { kind: 'shim', serverBaseUrl: 's' },
            { compatibilityProvider: () => 'unknown' },
        );
        expect(pipeline.kind).toBe('shim');
    });

    // Pre-Phase-11b bug fix: env=overlay-v1 used to fall through to shim
    // because resolveMobilePreviewPipelineConfig only mapped the literal
    // 'two-tier' kind. Per Phase 11a ADR, overlay-v1 IS a sub-mode of the
    // TwoTier pipeline (the inner sync() flag picks v1 vs legacy push
    // shape), so the construction config must be the same.
    test("env='overlay-v1' resolves to a two-tier-shaped config (not shim)", () => {
        mockEnv.NEXT_PUBLIC_MOBILE_PREVIEW_PIPELINE = 'overlay-v1';
        const config = resolveMobilePreviewPipelineConfig();
        expect(config.kind).toBe('two-tier');
        if (config.kind !== 'two-tier') return;
        expect(config.builderBaseUrl).toBe('https://builder.test');
        expect(config.relayBaseUrl).toBe('https://relay.test');
    });

    test("env='overlay-v1' creates the TwoTier pipeline (not shim)", () => {
        mockEnv.NEXT_PUBLIC_MOBILE_PREVIEW_PIPELINE = 'overlay-v1';
        const pipeline = createMobilePreviewPipeline();
        expect(pipeline.kind).toBe('two-tier');
        expect(pipeline.capabilities).toEqual({
            liveUpdates: true,
            onlookDeepLink: true,
        });
    });

    test("getMobilePreviewPipelineCapabilities('overlay-v1') matches TwoTier", () => {
        expect(getMobilePreviewPipelineCapabilities('overlay-v1')).toEqual({
            liveUpdates: true,
            onlookDeepLink: true,
        });
    });

    test("env='overlay-v1' threads compatibilityProvider through to the pipeline", () => {
        mockEnv.NEXT_PUBLIC_MOBILE_PREVIEW_PIPELINE = 'overlay-v1';
        let calls = 0;
        const pipeline = createMobilePreviewPipeline(undefined, {
            compatibilityProvider: () => {
                calls += 1;
                return 'ok';
            },
        });
        expect(pipeline.kind).toBe('two-tier');
        expect(calls).toBe(0); // lazy — only sync() invokes it
    });
});

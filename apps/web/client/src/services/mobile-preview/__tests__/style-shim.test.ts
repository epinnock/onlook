import { describe, expect, test } from 'bun:test';
import React from 'react';
import { buildMobilePreviewBundle, type MobilePreviewVfs } from '../index';
import {
    STYLE_HELPERS_GLOBAL_KEY,
    wrapEvalBundle,
} from '../bundler/wrap-eval-bundle';

type RuntimeGlobalState = {
    [STYLE_HELPERS_GLOBAL_KEY]?: unknown;
    React?: typeof React;
    RawText?: string;
    TextC?: (props: { children?: React.ReactNode }) => React.ReactElement;
    View?: string;
    renderApp?: (element: unknown) => void;
};

type StyleHelpers = {
    composeStyles: (a: unknown, b: unknown) => unknown;
    createStyleSheet: (styles: Record<string, unknown>) => Record<string, unknown>;
    cssColorToArgb: (value: unknown) => unknown;
    flattenStyle: (style: unknown) => Record<string, unknown>;
};

function resolveRenderedElement(
    element: React.ReactElement,
): React.ReactElement<Record<string, unknown>> {
    if (typeof element.type !== 'function') {
        return element as React.ReactElement<Record<string, unknown>>;
    }

    return element.type(
        element.props,
    ) as React.ReactElement<Record<string, unknown>>;
}

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

function withRuntimeGlobals(run: (runtimeGlobal: RuntimeGlobalState) => Promise<void> | void) {
    const runtimeGlobal = globalThis as typeof globalThis & RuntimeGlobalState;
    const previousState = {
        styleHelpers: runtimeGlobal[STYLE_HELPERS_GLOBAL_KEY],
        React: runtimeGlobal.React,
        RawText: runtimeGlobal.RawText,
        TextC: runtimeGlobal.TextC,
        View: runtimeGlobal.View,
        renderApp: runtimeGlobal.renderApp,
    };

    runtimeGlobal.React = React;
    runtimeGlobal.View = 'View';
    runtimeGlobal.RawText = 'RCTRawText';
    runtimeGlobal.TextC = ({ children }) =>
        React.createElement('RCTText', null, children);

    return Promise.resolve()
        .then(() => run(runtimeGlobal))
        .finally(() => {
            if (previousState.styleHelpers === undefined) {
                delete runtimeGlobal[STYLE_HELPERS_GLOBAL_KEY];
            } else {
                runtimeGlobal[STYLE_HELPERS_GLOBAL_KEY] =
                    previousState.styleHelpers;
            }
            runtimeGlobal.React = previousState.React;
            runtimeGlobal.RawText = previousState.RawText;
            runtimeGlobal.TextC = previousState.TextC;
            runtimeGlobal.View = previousState.View;
            runtimeGlobal.renderApp = previousState.renderApp;
        });
}

describe('mobile preview style helpers', () => {
    test('runtime style shim installs shared helpers', async () => {
        const styleShimModule = await import(
            '../../../../../../../packages/mobile-preview/runtime/shims/core/style.js'
        );
        const styleShim = (styleShimModule.default ??
            styleShimModule) as unknown as {
            install: (target: Record<string, unknown>) => StyleHelpers;
        };

        const target: Record<string, unknown> = {};
        const helpers = styleShim.install(target);

        expect(target[STYLE_HELPERS_GLOBAL_KEY]).toBe(helpers);
        expect(helpers.cssColorToArgb('#112233')).toBe(0xff112233 | 0);
        expect(
            helpers.flattenStyle([
                { borderTopColor: '#abcdef80' },
                { color: 'rgba(255, 255, 255, 0.5)', padding: 4 },
            ]),
        ).toEqual({
            borderTopColor: 0x80abcdef | 0,
            color: 0x80ffffff | 0,
            padding: 4,
        });
    });

    test('wrapEvalBundle reuses preinstalled shared helpers', async () => {
        await withRuntimeGlobals((runtimeGlobal) => {
            const renderAppCalls: unknown[] = [];
            const sharedHelpers = {
                composeStyles: (a: unknown, b: unknown) => ({
                    marker: 'compose',
                    left: a,
                    right: b,
                }),
                createStyleSheet: (styles: Record<string, unknown>) => ({
                    root: {
                        marker: 'create',
                        ...styles.root,
                    },
                }),
                cssColorToArgb: (value: unknown) => value,
                flattenStyle: (style: unknown) => ({ marker: 'flatten', style }),
            };

            runtimeGlobal[STYLE_HELPERS_GLOBAL_KEY] = sharedHelpers;
            runtimeGlobal.renderApp = (element) => {
                renderAppCalls.push(element);
            };

            const code = wrapEvalBundle('App.js', ['App.js'], {
                'App.js': `
                    const React = require('react');
                    const { StyleSheet, View } = require('react-native');

                    const styles = StyleSheet.create({
                        root: { backgroundColor: '#112233' },
                    });

                    module.exports = function App() {
                        return React.createElement(View, {
                            style: StyleSheet.compose(styles.root, { padding: 4 }),
                        });
                    };
                `,
            });

            (0, eval)(code);

            expect(renderAppCalls).toHaveLength(1);
            const element = resolveRenderedElement(
                renderAppCalls[0] as React.ReactElement,
            );
            expect(element.props.style).toEqual({
                marker: 'compose',
                left: {
                    marker: 'create',
                    backgroundColor: '#112233',
                },
                right: {
                    padding: 4,
                },
            });
        });
    });

    test('buildMobilePreviewBundle installs fallback style helpers', async () => {
        const bundle = await buildMobilePreviewBundle(
            makeFakeVfs({
                'package.json': JSON.stringify({ main: 'App.tsx' }),
                'App.tsx': `
                    import { StyleSheet, View } from 'react-native';

                    const styles = StyleSheet.create({
                        root: {
                            backgroundColor: '#112233',
                            borderTopColor: '#abcdef80',
                        },
                    });

                    export default function App() {
                        return (
                            <View
                                style={StyleSheet.compose(styles.root, [
                                    { color: 'rgba(255, 255, 255, 0.5)' },
                                    { padding: 4 },
                                ])}
                            />
                        );
                    }
                `,
            }),
        );

        await withRuntimeGlobals((runtimeGlobal) => {
            const renderAppCalls: unknown[] = [];
            delete runtimeGlobal[STYLE_HELPERS_GLOBAL_KEY];
            runtimeGlobal.renderApp = (element) => {
                renderAppCalls.push(element);
            };

            (0, eval)(bundle.code);

            expect(renderAppCalls).toHaveLength(1);
            const element = resolveRenderedElement(
                renderAppCalls[0] as React.ReactElement,
            );
            expect(element.props.style).toEqual({
                backgroundColor: 0xff112233 | 0,
                borderTopColor: 0x80abcdef | 0,
                color: 0x80ffffff | 0,
                padding: 4,
            });

            const helpers = runtimeGlobal[
                STYLE_HELPERS_GLOBAL_KEY
            ] as StyleHelpers;
            expect(helpers.cssColorToArgb('transparent')).toBe(0);
        });
    });
});

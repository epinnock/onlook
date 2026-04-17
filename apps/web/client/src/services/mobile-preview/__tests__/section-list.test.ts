import { describe, expect, test } from 'bun:test';
import React from 'react';

import { wrapEvalBundle } from '../bundler/wrap-eval-bundle';

const reactNativeShim = require('../../../../../../../packages/mobile-preview/runtime/shims/core/react-native.js') as {
    MODULE_ID: string;
    RUNTIME_SHIM_REGISTRY_KEY: string;
    install: (target: RuntimeGlobalState) => ReactNativeModule;
};

const sectionListShim = require('../../../../../../../packages/mobile-preview/runtime/shims/core/section-list.js') as {
    REACT_NATIVE_MODULE_ID: string;
    SHIM_ID: string;
    install: (target: RuntimeGlobalState) => SectionListComponent;
};

type RuntimeGlobalState = {
    React?: typeof React;
    RawText?: string;
    TextC?:
        | string
        | ((props: { children?: React.ReactNode }) => React.ReactElement);
    View?: string;
    __onlookShims?: Record<string, unknown>;
    renderApp?: (element: unknown) => void;
};

type ReactNativeModule = Record<string, unknown> & {
    ScrollView: (props: Record<string, unknown>) => React.ReactElement;
    SectionList?: SectionListComponent;
    default?: unknown;
    __esModule?: boolean;
};

type SectionListComponent = (props: Record<string, unknown>) => React.ReactElement;

function createTarget(
    overrides: Partial<RuntimeGlobalState> = {},
): RuntimeGlobalState {
    return {
        React,
        View: 'View',
        RawText: 'RCTRawText',
        TextC: 'Text',
        ...overrides,
    };
}

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

function resolveRenderedChildren(
    children: React.ReactNode,
): Array<React.ReactElement<Record<string, unknown>>> {
    return React.Children.toArray(children).map((child) =>
        React.isValidElement(child)
            ? resolveRenderedElement(
                  child as React.ReactElement<Record<string, unknown>>,
              )
            : (child as React.ReactElement<Record<string, unknown>>),
    );
}

function withRuntimeGlobals(
    run: (runtimeGlobal: RuntimeGlobalState) => Promise<void> | void,
) {
    const runtimeGlobal = globalThis as typeof globalThis & RuntimeGlobalState;
    const previousState = {
        React: runtimeGlobal.React,
        RawText: runtimeGlobal.RawText,
        TextC: runtimeGlobal.TextC,
        View: runtimeGlobal.View,
        renderApp: runtimeGlobal.renderApp,
        runtimeShims: runtimeGlobal.__onlookShims,
    };

    runtimeGlobal.React = React;
    runtimeGlobal.View = 'View';
    runtimeGlobal.RawText = 'RCTRawText';
    runtimeGlobal.TextC = 'Text';

    return Promise.resolve()
        .then(() => run(runtimeGlobal))
        .finally(() => {
            runtimeGlobal.React = previousState.React;
            runtimeGlobal.RawText = previousState.RawText;
            runtimeGlobal.TextC = previousState.TextC;
            runtimeGlobal.View = previousState.View;
            runtimeGlobal.renderApp = previousState.renderApp;

            if (previousState.runtimeShims === undefined) {
                delete runtimeGlobal.__onlookShims;
            } else {
                runtimeGlobal.__onlookShims = previousState.runtimeShims;
            }
        });
}

describe('section-list shim', () => {
    test('installs SectionList into the existing react-native runtime module', () => {
        const target = createTarget();
        const reactNativeModule = reactNativeShim.install(target);

        const SectionList = sectionListShim.install(target);
        const registry = target[
            reactNativeShim.RUNTIME_SHIM_REGISTRY_KEY
        ] as Record<string, unknown>;

        expect(registry[sectionListShim.REACT_NATIVE_MODULE_ID]).toBe(
            reactNativeModule,
        );
        expect(reactNativeModule.SectionList).toBe(SectionList);
        expect(reactNativeModule.default).toBe(reactNativeModule);
        expect(reactNativeModule.__esModule).toBe(true);
    });

    test('renders sections through the ScrollView path with headers, items, and separators', () => {
        const target = createTarget();
        const reactNativeModule = reactNativeShim.install(target);
        const SectionList = sectionListShim.install(target);

        const element = SectionList({
            sections: [
                {
                    key: 'favorites',
                    title: 'Favorites',
                    data: [{ id: 'a', label: 'Apple' }, { id: 'b', label: 'Banana' }],
                },
                {
                    key: 'recent',
                    title: 'Recent',
                    data: [{ id: 'c', label: 'Cherry' }],
                },
            ],
            renderSectionHeader: ({ section }: { section: { title: string } }) =>
                React.createElement('Header', { title: section.title }),
            renderItem: ({
                item,
                index,
                section,
            }: {
                item: { label: string };
                index: number;
                section: { key: string };
            }) =>
                React.createElement('Row', {
                    label: item.label,
                    index,
                    sectionKey: section.key,
                }),
            ItemSeparatorComponent: () => React.createElement('ItemSeparator'),
            SectionSeparatorComponent: () =>
                React.createElement('SectionSeparator'),
            ListHeaderComponent: () => React.createElement('ListHeader'),
            ListFooterComponent: () => React.createElement('ListFooter'),
            stickySectionHeadersEnabled: true,
            testID: 'section-list',
        });

        expect(element.type).toBe(reactNativeModule.ScrollView);

        const rendered = resolveRenderedElement(element);
        const children = resolveRenderedChildren(rendered.props.children);

        expect(rendered.type).toBe('View');
        expect(rendered.props.testID).toBe('section-list');
        expect(rendered.props.stickySectionHeadersEnabled).toBe(true);
        expect(children.map((child) => child.type)).toEqual([
            'ListHeader',
            'Header',
            'Row',
            'ItemSeparator',
            'Row',
            'SectionSeparator',
            'Header',
            'Row',
            'ListFooter',
        ]);
        expect(children[1]?.props.title).toBe('Favorites');
        expect(children[2]?.props).toEqual({
            label: 'Apple',
            index: 0,
            sectionKey: 'favorites',
        });
        expect(children[4]?.props).toEqual({
            label: 'Banana',
            index: 1,
            sectionKey: 'favorites',
        });
        expect(children[7]?.props).toEqual({
            label: 'Cherry',
            index: 0,
            sectionKey: 'recent',
        });
    });

    test('renders empty state and supports registry-backed require through wrapEvalBundle', async () => {
        await withRuntimeGlobals((runtimeGlobal) => {
            const renderAppCalls: unknown[] = [];
            runtimeGlobal.renderApp = (element) => {
                renderAppCalls.push(element);
            };

            reactNativeShim.install(runtimeGlobal);
            sectionListShim.install(runtimeGlobal);

            const code = wrapEvalBundle('App.js', ['App.js'], {
                'App.js': `
                    const React = require('react');
                    const { SectionList } = require('react-native');

                    module.exports = function App() {
                        return React.createElement(SectionList, {
                            sections: [],
                            ListEmptyComponent: () => React.createElement('EmptyState', { label: 'No rows' }),
                            testID: 'runtime-section-list',
                        });
                    };
                `,
            });

            (0, eval)(code);

            expect(renderAppCalls).toHaveLength(1);

            const appElement = resolveRenderedElement(
                renderAppCalls[0] as React.ReactElement,
            );
            const rendered = resolveRenderedElement(appElement);
            const children = resolveRenderedChildren(rendered.props.children);

            expect(children).toHaveLength(1);
            expect(children[0]?.type).toBe('EmptyState');
            expect(children[0]?.props.label).toBe('No rows');
            expect(runtimeGlobal.__onlookShims?.[sectionListShim.REACT_NATIVE_MODULE_ID]).toBe(
                runtimeGlobal.__onlookShims?.[reactNativeShim.MODULE_ID],
            );
        });
    });
});

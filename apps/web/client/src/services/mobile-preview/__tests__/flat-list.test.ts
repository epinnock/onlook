import { describe, expect, test } from 'bun:test';
import React from 'react';

const flatListShim = require('../../../../../../../packages/mobile-preview/runtime/shims/core/flat-list.js') as {
    REACT_NATIVE_MODULE_ID: string;
    RUNTIME_SHIM_REGISTRY_KEY: string;
    SHIM_ID: string;
    createFlatListComponent: (target: RuntimeTarget) => React.ComponentType<Record<string, unknown>>;
    install: (target: RuntimeTarget) => { FlatList: React.ComponentType<Record<string, unknown>> };
};

type RuntimeTarget = Record<string, unknown> & {
    React?: typeof React;
    Text?: string;
    TextC?: (props: { children?: React.ReactNode; testID?: string }) => React.ReactElement;
    RawText?: string;
    View?: string;
    __onlookShims?: Record<string, unknown>;
};

function createTarget(overrides: Partial<RuntimeTarget> = {}): RuntimeTarget {
    return {
        React,
        View: 'View',
        Text: 'RCTText',
        RawText: 'RCTRawText',
        TextC: ({ children, ...rest }) =>
            React.createElement('RCTText', rest, children),
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

function ScrollMarker(props: Record<string, unknown>) {
    return React.createElement('ScrollViewMarker', props, props.children);
}

function TextMarker(props: { children?: React.ReactNode; testID?: string }) {
    return React.createElement('TextMarker', props, props.children);
}

describe('flat-list shim', () => {
    test('installs FlatList into the react-native runtime module', () => {
        const target = createTarget({
            TextC: TextMarker,
            __onlookShims: {
                [flatListShim.REACT_NATIVE_MODULE_ID]: {
                    Existing: true,
                    ScrollView: ScrollMarker,
                    View: 'View',
                },
            },
        });

        const installed = flatListShim.install(target);
        const reactNativeModule = target[flatListShim.RUNTIME_SHIM_REGISTRY_KEY]?.[
            flatListShim.REACT_NATIVE_MODULE_ID
        ] as Record<string, unknown>;

        expect(installed.FlatList).toBe(reactNativeModule.FlatList);
        expect(reactNativeModule.Existing).toBe(true);
        expect(typeof reactNativeModule.FlatList).toBe('function');
        expect(reactNativeModule.default).toBe(reactNativeModule);
        expect(reactNativeModule.__esModule).toBe(true);
    });

    test('renders FlatList through the non-virtualized ScrollView path', () => {
        const target = createTarget({
            TextC: TextMarker,
            __onlookShims: {
                [flatListShim.REACT_NATIVE_MODULE_ID]: {
                    ScrollView: ScrollMarker,
                    View: 'View',
                },
            },
        });
        const FlatList = flatListShim.createFlatListComponent(target);

        const element = FlatList({
            data: [
                { id: 'a', label: 'Alpha' },
                { id: 'b', label: 'Beta' },
            ],
            ItemSeparatorComponent: () =>
                React.createElement('SeparatorMarker', { role: 'separator' }),
            ListFooterComponent: () =>
                React.createElement('FooterMarker', { role: 'footer' }),
            ListHeaderComponent: () =>
                React.createElement('HeaderMarker', { role: 'header' }),
            renderItem: ({ item, index }: { item: { label: string }; index: number }) =>
                React.createElement('RowMarker', { index, label: item.label }),
            testID: 'feed',
        }) as React.ReactElement;

        expect(element.type).toBe(ScrollMarker);
        expect(element.props.testID).toBe('feed');
        const children = React.Children.toArray(
            element.props.children,
        ) as React.ReactElement[];

        expect(children).toHaveLength(5);
        expect(resolveRenderedElement(children[0]).type).toBe('HeaderMarker');
        expect(children[1].type).toBe(React.Fragment);
        expect(String(children[1].key)).toContain('a');
        expect(
            (children[1].props as { children: React.ReactElement }).children.props,
        ).toMatchObject({
            index: 0,
            label: 'Alpha',
        });
        expect(resolveRenderedElement(children[2]).type).toBe('SeparatorMarker');
        expect(
            (children[3].props as { children: React.ReactElement }).children.props,
        ).toMatchObject({
            index: 1,
            label: 'Beta',
        });
        expect(resolveRenderedElement(children[4]).type).toBe('FooterMarker');
    });

    test('supports empty state, key extraction, and custom cell renderers', () => {
        const target = createTarget({
            __onlookShims: {
                [flatListShim.REACT_NATIVE_MODULE_ID]: {
                    ScrollView: ScrollMarker,
                    View: 'View',
                },
            },
        });
        const FlatList = flatListShim.createFlatListComponent(target);

        const emptyElement = FlatList({
            ListEmptyComponent: React.createElement('EmptyMarker', { role: 'empty' }),
            data: [],
        }) as React.ReactElement;

        const emptyChildren = React.Children.toArray(
            emptyElement.props.children,
        ) as React.ReactElement[];

        expect(emptyChildren).toHaveLength(1);
        expect(emptyChildren[0].type).toBe('EmptyMarker');

        const populatedElement = FlatList({
            CellRendererComponent: ({
                children,
                index,
                item,
            }: {
                children: React.ReactNode;
                index: number;
                item: { slug: string };
            }) =>
                React.createElement('CellMarker', {
                    child: children,
                    index,
                    slug: item.slug,
                }),
            data: [{ slug: 'first' }],
            keyExtractor: (item: { slug: string }) => `key:${item.slug}`,
            renderItem: ({ item }: { item: { slug: string } }) =>
                React.createElement('RowMarker', { slug: item.slug }),
        }) as React.ReactElement;

        const populatedChildren = React.Children.toArray(
            populatedElement.props.children,
        ) as React.ReactElement[];

        expect(populatedChildren).toHaveLength(1);
        expect(resolveRenderedElement(populatedChildren[0]).type).toBe(
            'CellMarker',
        );
        expect(String(populatedChildren[0].key)).toContain('key');
        expect(String(populatedChildren[0].key)).toContain('first');
        expect(resolveRenderedElement(populatedChildren[0]).props).toMatchObject({
            index: 0,
            slug: 'first',
        });
    });
});

import { describe, expect, test } from 'bun:test';
import {
    ReactNodeDescriptorSchema,
    RectSchema,
    TapResultSchema,
    type ReactNodeDescriptor,
} from './inspector.ts';

describe('RectSchema', () => {
    test('accepts a standard rect', () => {
        const parsed = RectSchema.parse({ x: 10, y: 20, width: 100, height: 50 });
        expect(parsed.width).toBe(100);
    });

    test('rejects negative width', () => {
        expect(() =>
            RectSchema.parse({ x: 0, y: 0, width: -1, height: 10 }),
        ).toThrow();
    });
});

describe('TapResultSchema', () => {
    test('parses a tap result', () => {
        const parsed = TapResultSchema.parse({
            reactTag: 42,
            viewName: 'RCTView',
            frame: { x: 0, y: 0, width: 100, height: 50 },
        });
        expect(parsed.reactTag).toBe(42);
        expect(parsed.viewName).toBe('RCTView');
    });

    test('rejects empty viewName', () => {
        expect(() =>
            TapResultSchema.parse({
                reactTag: 1,
                viewName: '',
                frame: { x: 0, y: 0, width: 10, height: 10 },
            }),
        ).toThrow();
    });
});

describe('ReactNodeDescriptorSchema', () => {
    const LEAF: ReactNodeDescriptor = {
        tag: 3,
        viewName: 'RCTText',
        props: { text: 'Hello, Onlook!' },
        children: [],
    };
    const TREE: ReactNodeDescriptor = {
        tag: 1,
        viewName: 'RCTView',
        props: { style: { flex: 1 } },
        children: [
            {
                tag: 2,
                viewName: 'RCTView',
                props: {},
                children: [LEAF],
            },
        ],
    };

    test('parses a flat leaf node', () => {
        const parsed = ReactNodeDescriptorSchema.parse(LEAF);
        expect(parsed.viewName).toBe('RCTText');
        expect(parsed.children).toHaveLength(0);
    });

    test('parses a recursive tree (Fabric walk)', () => {
        const parsed = ReactNodeDescriptorSchema.parse(TREE);
        expect(parsed.children).toHaveLength(1);
        expect(parsed.children[0]?.children[0]?.viewName).toBe('RCTText');
    });

    test('rejects child that is not a descriptor', () => {
        expect(() =>
            ReactNodeDescriptorSchema.parse({
                tag: 1,
                viewName: 'RCTView',
                props: {},
                children: [{ not: 'a node' }],
            }),
        ).toThrow();
    });
});

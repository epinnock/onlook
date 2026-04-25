import { describe, expect, test } from 'bun:test';

import { BAD_COMPONENTS, containsBadComponent } from '../badComponentFilter';

describe('containsBadComponent', () => {
    test('returns false for null / undefined / primitives', () => {
        expect(containsBadComponent(null)).toBe(false);
        expect(containsBadComponent(undefined)).toBe(false);
        expect(containsBadComponent('a string')).toBe(false);
        expect(containsBadComponent(42)).toBe(false);
    });

    test('BAD_COMPONENTS is the raw-native set', () => {
        expect(BAD_COMPONENTS.has('RCTRawText')).toBe(true);
        expect(BAD_COMPONENTS.has('RCTText')).toBe(true);
        expect(BAD_COMPONENTS.has('RCTView')).toBe(true);
        expect(BAD_COMPONENTS.size).toBe(3);
    });

    test('flags a top-level bad component', () => {
        expect(containsBadComponent({ type: 'RCTRawText', props: {} })).toBe(true);
        expect(containsBadComponent({ type: 'RCTText', props: {} })).toBe(true);
        expect(containsBadComponent({ type: 'RCTView', props: {} })).toBe(true);
    });

    test('passes safe component types (functions, View/Text strings, symbols)', () => {
        const Fn = () => null;
        expect(containsBadComponent({ type: Fn, props: {} })).toBe(false);
        expect(containsBadComponent({ type: 'View', props: {} })).toBe(false);
        expect(containsBadComponent({ type: 'Text', props: {} })).toBe(false);
    });

    test('flags a bad component nested as single child', () => {
        const tree = {
            type: 'View',
            props: { children: { type: 'RCTText', props: {} } },
        };
        expect(containsBadComponent(tree)).toBe(true);
    });

    test('flags a bad component inside a children array', () => {
        const tree = {
            type: 'View',
            props: {
                children: [
                    { type: 'Text', props: { children: 'ok' } },
                    { type: 'RCTView', props: {} },
                ],
            },
        };
        expect(containsBadComponent(tree)).toBe(true);
    });

    test('returns false for a deep safe tree', () => {
        const tree = {
            type: 'View',
            props: {
                children: [
                    {
                        type: 'View',
                        props: {
                            children: {
                                type: 'Text',
                                props: { children: 'deep leaf' },
                            },
                        },
                    },
                ],
            },
        };
        expect(containsBadComponent(tree)).toBe(false);
    });

    test('recurses through deeply nested bad components', () => {
        const tree = {
            type: 'View',
            props: {
                children: [
                    {
                        type: 'View',
                        props: {
                            children: [
                                {
                                    type: 'View',
                                    props: {
                                        children: { type: 'RCTRawText', props: {} },
                                    },
                                },
                            ],
                        },
                    },
                ],
            },
        };
        expect(containsBadComponent(tree)).toBe(true);
    });

    test('handles elements without props gracefully', () => {
        expect(containsBadComponent({ type: 'View' })).toBe(false);
        expect(containsBadComponent({ type: 'RCTRawText' })).toBe(true);
    });
});

import { describe, expect, test } from 'bun:test';
import {
    isOverlayMessage,
    OverlayMessageSchema,
} from '../src/overlay.ts';

describe('OverlayMessageSchema', () => {
    test('parses overlay code without sourceMap', () => {
        const parsed = OverlayMessageSchema.parse({
            type: 'overlay',
            code: 'console.log("hello");',
        });

        expect(parsed.type).toBe('overlay');
        expect(parsed.code).toContain('hello');
        expect(parsed.sourceMap).toBeUndefined();
    });

    test('parses overlay code with a string sourceMap', () => {
        const parsed = OverlayMessageSchema.parse({
            type: 'overlay',
            code: 'export default 1;',
            sourceMap: 'data:application/json;base64,eyJ2IjoxfQ==',
        });

        expect(parsed.sourceMap).toContain('data:application/json');
    });

    test('parses overlay code with an object sourceMap', () => {
        const parsed = OverlayMessageSchema.parse({
            type: 'overlay',
            code: 'export default 1;',
            sourceMap: {
                version: 3,
                sources: ['App.tsx'],
                mappings: 'AAAA',
            },
        });

        expect(typeof parsed.sourceMap).toBe('object');
        if (parsed.sourceMap == null || typeof parsed.sourceMap === 'string') {
            throw new Error('narrow');
        }
        expect(parsed.sourceMap.sources).toEqual(['App.tsx']);
    });

    test('rejects empty code', () => {
        expect(() =>
            OverlayMessageSchema.parse({
                type: 'overlay',
                code: '',
            }),
        ).toThrow();
    });

    test('rejects non-object sourceMap values', () => {
        expect(() =>
            OverlayMessageSchema.parse({
                type: 'overlay',
                code: 'export default 1;',
                sourceMap: 42,
            }),
        ).toThrow();
    });

    test('guard accepts valid overlay payloads', () => {
        expect(
            isOverlayMessage({
                type: 'overlay',
                code: 'export default 1;',
                sourceMap: { version: 3 },
            }),
        ).toBe(true);
    });

    test('guard rejects invalid overlay payloads', () => {
        expect(isOverlayMessage({ type: 'overlay', code: '' })).toBe(false);
    });
});

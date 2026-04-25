import { describe, expect, test } from 'bun:test';
import type { ErrorMessage } from '@onlook/mobile-client-protocol';

import {
    decodeVlqSegment,
    decorateErrorMessageWithSourceMap,
    decorateRuntimeErrorWithSourceMap,
    fetchOverlaySourceMap,
    resolveOverlayFrame,
    type RawSourceMap,
} from '../overlay-sourcemap';

describe('overlay-sourcemap / fetchOverlaySourceMap', () => {
    test('fetches + parses a valid v3 source map', async () => {
        const fake: RawSourceMap = {
            version: 3,
            sources: ['App.tsx'],
            names: [],
            mappings: 'AAAA',
        };
        const fetchImpl: (i: RequestInfo | URL, init?: RequestInit) => Promise<Response> =
            async () =>
                new Response(JSON.stringify(fake), {
                    headers: { 'Content-Type': 'application/json' },
                });
        const result = await fetchOverlaySourceMap({ url: 'https://r2/m', fetchImpl });
        expect(result).toEqual(fake);
    });

    test('returns null on HTTP error', async () => {
        const fetchImpl: (i: RequestInfo | URL, init?: RequestInit) => Promise<Response> =
            async () => new Response('boom', { status: 500 });
        const result = await fetchOverlaySourceMap({ url: 'https://r2/m', fetchImpl });
        expect(result).toBeNull();
    });

    test('returns null on malformed JSON or non-v3 shape', async () => {
        const fetchImpl: (i: RequestInfo | URL, init?: RequestInit) => Promise<Response> =
            async () => new Response('not json');
        expect(await fetchOverlaySourceMap({ url: 'https://r2/m', fetchImpl })).toBeNull();
        const fetchImpl2: (i: RequestInfo | URL, init?: RequestInit) => Promise<Response> =
            async () => new Response(JSON.stringify({ version: 2 }));
        expect(
            await fetchOverlaySourceMap({ url: 'https://r2/m', fetchImpl: fetchImpl2 }),
        ).toBeNull();
    });
});

describe('overlay-sourcemap / decodeVlqSegment', () => {
    test('decodes known values', () => {
        // "AAAA" → [0,0,0,0]
        expect(decodeVlqSegment('AAAA')).toEqual([0, 0, 0, 0]);
        // "GAAK" — generated-column=3, source=0, line=0, col=5
        const out = decodeVlqSegment('GAAK');
        expect(out[0]).toBe(3);
        expect(out[3]).toBe(5);
    });
});

describe('overlay-sourcemap / resolveOverlayFrame', () => {
    test('resolves a zero-offset frame to the first source line', () => {
        const map: RawSourceMap = {
            version: 3,
            sources: ['App.tsx'],
            names: [],
            // One segment: (0,0,0,0) = gen (0,0) → source index 0, line 0, col 0
            mappings: 'AAAA',
        };
        const r = resolveOverlayFrame(map, 1, 0);
        expect(r).toEqual({ fileName: 'App.tsx', lineNumber: 1, columnNumber: 0 });
    });

    test('returns null when line is out of range', () => {
        const map: RawSourceMap = {
            version: 3,
            sources: ['App.tsx'],
            names: [],
            mappings: 'AAAA',
        };
        expect(resolveOverlayFrame(map, 999, 0)).toBeNull();
    });
});

describe('overlay-sourcemap / decorateRuntimeErrorWithSourceMap', () => {
    test('annotates the error with resolved source when a frame matches', () => {
        const map: RawSourceMap = {
            version: 3,
            sources: ['App.tsx'],
            names: [],
            mappings: 'AAAA',
        };
        const decorated = decorateRuntimeErrorWithSourceMap(
            {
                kind: 'overlay-runtime',
                message: 'boom',
                stack: 'at overlay.js:1:0',
            },
            map,
        );
        expect(decorated.source).toEqual({
            fileName: 'App.tsx',
            lineNumber: 1,
            columnNumber: 0,
        });
    });

    test('returns the input unchanged when no frame matches', () => {
        const err = { kind: 'overlay-runtime' as const, message: 'm' };
        expect(decorateRuntimeErrorWithSourceMap(err, null)).toBe(err);
    });
});

describe('overlay-sourcemap / decorateErrorMessageWithSourceMap', () => {
    function makeErrMsg(overrides: Partial<ErrorMessage> = {}): ErrorMessage {
        return {
            type: 'onlook:error',
            sessionId: 'sess-1',
            kind: 'js',
            message: 'boom',
            timestamp: 1_712_000_000_000,
            ...overrides,
        };
    }

    test('annotates with resolved source when a frame matches', () => {
        const map: RawSourceMap = {
            version: 3,
            sources: ['App.tsx'],
            names: [],
            mappings: 'AAAA',
        };
        const decorated = decorateErrorMessageWithSourceMap(
            makeErrMsg({ stack: 'at bundle.js:1:0' }),
            map,
        );
        expect(decorated.source).toEqual({
            fileName: 'App.tsx',
            lineNumber: 1,
            columnNumber: 0,
        });
    });

    test('returns input unchanged when map is null', () => {
        const msg = makeErrMsg({ stack: 'at bundle.js:1:0' });
        expect(decorateErrorMessageWithSourceMap(msg, null)).toBe(msg);
    });

    test('returns input unchanged when stack is absent (errors w/o frames)', () => {
        const msg = makeErrMsg();
        const map: RawSourceMap = {
            version: 3,
            sources: ['App.tsx'],
            names: [],
            mappings: 'AAAA',
        };
        expect(decorateErrorMessageWithSourceMap(msg, map)).toBe(msg);
    });

    test('returns input unchanged when stack regex finds no frame match', () => {
        const msg = makeErrMsg({ stack: 'no frames here' });
        const map: RawSourceMap = {
            version: 3,
            sources: ['App.tsx'],
            names: [],
            mappings: 'AAAA',
        };
        expect(decorateErrorMessageWithSourceMap(msg, map)).toBe(msg);
    });

    test('preserves other ErrorMessage fields verbatim', () => {
        const map: RawSourceMap = {
            version: 3,
            sources: ['App.tsx'],
            names: [],
            mappings: 'AAAA',
        };
        const msg = makeErrMsg({
            stack: 'at bundle.js:1:0',
            kind: 'react',
            message: 'render boom',
        });
        const decorated = decorateErrorMessageWithSourceMap(msg, map);
        expect(decorated.kind).toBe('react');
        expect(decorated.message).toBe('render boom');
        expect(decorated.sessionId).toBe(msg.sessionId);
        expect(decorated.timestamp).toBe(msg.timestamp);
    });
});

import { describe, expect, test } from 'bun:test';

import {
    attachSourceMapToBundleResult,
    extractAndAttachSourceMap,
    extractSourceMapText,
    normalizeSourceMapObject,
    normalizeSourceMapText,
    parseSourceMapText,
} from '../src/sourcemap';

describe('sourcemap helpers', () => {
    test('parses valid sourcemap JSON', () => {
        const parsed = parseSourceMapText(
            '{"version":3,"sources":["src/App.tsx"],"names":[],"mappings":"AAAA"}',
        );

        expect(parsed).toEqual({
            version: 3,
            sources: ['src/App.tsx'],
            names: [],
            mappings: 'AAAA',
        });
    });

    test('returns undefined for invalid JSON', () => {
        expect(parseSourceMapText('{')).toBeUndefined();
    });

    test('normalizes undefined source maps', () => {
        expect(normalizeSourceMapText(undefined)).toBeUndefined();
        expect(normalizeSourceMapObject(undefined)).toBeUndefined();
        expect(extractSourceMapText(undefined)).toBeUndefined();
    });

    test('attaches source map text to bundle results', () => {
        const attached = attachSourceMapToBundleResult(
            { code: 'module.exports = 1;' },
            { version: 3, sources: ['src/App.tsx'], names: [], mappings: 'AAAA' },
        );

        expect(attached).toEqual({
            code: 'module.exports = 1;',
            sourceMap:
                '{"version":3,"sources":["src/App.tsx"],"names":[],"mappings":"AAAA"}',
        });
    });

    test('extracts and attaches sourcemaps from bundle output', () => {
        const attached = extractAndAttachSourceMap({
            outputFiles: [
                { path: 'out.js', text: 'module.exports = 1;' },
                {
                    path: 'out.js.map',
                    text: '{"version":3,"sources":["src/App.tsx"],"names":[],"mappings":"AAAA"}',
                },
            ],
        });

        expect(attached.sourceMap).toBe(
            '{"version":3,"sources":["src/App.tsx"],"names":[],"mappings":"AAAA"}',
        );
        expect(extractSourceMapText(attached.outputFiles)).toBe(
            '{"version":3,"sources":["src/App.tsx"],"names":[],"mappings":"AAAA"}',
        );
    });
});

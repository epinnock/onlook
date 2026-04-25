import { describe, expect, test } from 'bun:test';

import { normalizeBrowserBundlerError } from '../src/errors';

describe('browser bundler error normalizer', () => {
    test('normalizes arrays of esbuild-like messages', () => {
        expect(
            normalizeBrowserBundlerError({
                errors: [
                    {
                        text: 'Unexpected token',
                        location: { file: 'src/App.tsx', line: 4, column: 7 },
                        notes: [{ text: 'JSX needs a parent element' }],
                    },
                    {
                        text: 'Missing export',
                        location: { file: 'src/main.ts', line: 1, column: 1 },
                    },
                ],
            }),
        ).toEqual([
            {
                message: 'Unexpected token',
                file: 'src/App.tsx',
                line: 4,
                column: 7,
                detail: 'JSX needs a parent element',
            },
            {
                message: 'Missing export',
                file: 'src/main.ts',
                line: 1,
                column: 1,
            },
        ]);
    });

    test('normalizes standard Error objects', () => {
        const result = normalizeBrowserBundlerError(new Error('Build exploded'));

        expect(result).toHaveLength(1);
        expect(result[0]).toMatchObject({
            message: 'Build exploded',
        });
        expect(result[0].detail).toContain('Build exploded');
    });

    test('normalizes unknown thrown values', () => {
        expect(normalizeBrowserBundlerError('plain failure')).toEqual([
            {
                message: 'plain failure',
            },
        ]);

        expect(normalizeBrowserBundlerError(42)).toEqual([
            {
                message: '42',
            },
        ]);
    });
});

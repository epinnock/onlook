import { describe, expect, test } from 'bun:test';
import type { AbiV1PreflightIssue } from '@onlook/browser-bundler';

import {
    formatPreflightShort,
    formatPreflightSummary,
} from '../preflight-formatter';

describe('preflight-formatter', () => {
    test('empty issues returns null for both helpers', () => {
        expect(formatPreflightSummary([])).toBeNull();
        expect(formatPreflightShort([])).toBeNull();
    });

    test('single unsupported-native issue', () => {
        const issues: AbiV1PreflightIssue[] = [
            {
                filePath: 'src/App.tsx',
                specifier: 'react-native-reanimated',
                kind: 'unsupported-native',
                message: 'boom',
            },
        ];
        const s = formatPreflightSummary(issues);
        expect(s?.title).toContain('native');
        expect(s?.lines).toHaveLength(1);
        expect(s?.lines[0]).toContain('react-native-reanimated');
        expect(s?.byKind['unsupported-native']).toHaveLength(1);
        expect(s?.byKind['unknown-specifier']).toHaveLength(0);
    });

    test('mixed kinds — unsupported-native takes header precedence', () => {
        const issues: AbiV1PreflightIssue[] = [
            {
                filePath: 'src/A.tsx',
                specifier: 'react-native-reanimated',
                kind: 'unsupported-native',
                message: 'x',
            },
            {
                filePath: 'src/B.tsx',
                specifier: 'lodash',
                kind: 'unknown-specifier',
                message: 'y',
            },
        ];
        const s = formatPreflightSummary(issues);
        expect(s?.title).toContain('native');
        expect(s?.lines).toHaveLength(2);
        expect(s?.byKind['unsupported-native']).toHaveLength(1);
        expect(s?.byKind['unknown-specifier']).toHaveLength(1);
    });

    test('formatPreflightShort collapses to a single status-bar line', () => {
        const issues: AbiV1PreflightIssue[] = [
            {
                filePath: 'A.tsx',
                specifier: 'lodash',
                kind: 'unknown-specifier',
                message: 'x',
            },
            {
                filePath: 'B.tsx',
                specifier: 'lodash',
                kind: 'unknown-specifier',
                message: 'y',
            },
            {
                filePath: 'C.tsx',
                specifier: 'zod',
                kind: 'unknown-specifier',
                message: 'z',
            },
        ];
        expect(formatPreflightShort(issues)).toBe(
            '3 imports rejected across 2 unique specifiers',
        );
    });

    test('formatPreflightShort singular spelling for exactly 1', () => {
        const issues: AbiV1PreflightIssue[] = [
            {
                filePath: 'A.tsx',
                specifier: 'lodash',
                kind: 'unknown-specifier',
                message: 'x',
            },
        ];
        expect(formatPreflightShort(issues)).toBe('1 import rejected: lodash');
    });

    // ─── Extended coverage ──────────────────────────────────────────────────

    test('single unknown-specifier issue uses the unknown-header title', () => {
        const s = formatPreflightSummary([
            { filePath: 'App.tsx', specifier: 'lodash', kind: 'unknown-specifier', message: 'x' },
        ]);
        expect(s?.title).toContain('Unknown bare import');
        expect(s?.lines).toHaveLength(1);
        expect(s?.lines[0]).toContain('lodash');
        expect(s?.byKind['unknown-specifier']).toHaveLength(1);
        expect(s?.byKind['unsupported-native']).toHaveLength(0);
    });

    test('native issues surface the "requires base/binary rebuild" guidance', () => {
        const s = formatPreflightSummary([
            { filePath: 'App.tsx', specifier: 'react-native-reanimated', kind: 'unsupported-native', message: 'x' },
        ]);
        expect(s?.lines[0]).toContain('requires base/binary rebuild');
    });

    test('unknown issues surface the "not in base alias map" guidance', () => {
        const s = formatPreflightSummary([
            { filePath: 'App.tsx', specifier: 'typo-package', kind: 'unknown-specifier', message: 'x' },
        ]);
        expect(s?.lines[0]).toContain('not in base alias map');
    });

    test('mixed kinds: native lines come before unknown lines (triage priority)', () => {
        const issues: AbiV1PreflightIssue[] = [
            { filePath: 'A.tsx', specifier: 'lodash', kind: 'unknown-specifier', message: 'x' },
            { filePath: 'B.tsx', specifier: 'react-native-reanimated', kind: 'unsupported-native', message: 'y' },
            { filePath: 'C.tsx', specifier: 'zod', kind: 'unknown-specifier', message: 'z' },
        ];
        const s = formatPreflightSummary(issues);
        expect(s?.lines).toHaveLength(3);
        // Native group first.
        expect(s?.lines[0]).toContain('react-native-reanimated');
        expect(s?.lines[1]).toContain('lodash');
        expect(s?.lines[2]).toContain('zod');
    });

    test('same specifier from two different files emits two lines (file-locality)', () => {
        const issues: AbiV1PreflightIssue[] = [
            { filePath: 'src/App.tsx', specifier: 'lodash', kind: 'unknown-specifier', message: 'x' },
            { filePath: 'src/utils.tsx', specifier: 'lodash', kind: 'unknown-specifier', message: 'x' },
        ];
        const s = formatPreflightSummary(issues);
        expect(s?.lines).toHaveLength(2);
        expect(s?.lines[0]).toContain('src/App.tsx');
        expect(s?.lines[1]).toContain('src/utils.tsx');
    });

    test('formatPreflightShort with many unique specifiers uses plural "specifiers"', () => {
        const issues: AbiV1PreflightIssue[] = [
            { filePath: 'A.tsx', specifier: 'a', kind: 'unknown-specifier', message: '' },
            { filePath: 'B.tsx', specifier: 'b', kind: 'unknown-specifier', message: '' },
            { filePath: 'C.tsx', specifier: 'c', kind: 'unknown-specifier', message: '' },
            { filePath: 'D.tsx', specifier: 'd', kind: 'unknown-specifier', message: '' },
        ];
        expect(formatPreflightShort(issues)).toBe(
            '4 imports rejected across 4 unique specifiers',
        );
    });

    test('formatPreflightShort with 1 unique specifier across 5 files uses singular "specifier"', () => {
        const issues: AbiV1PreflightIssue[] = Array.from({ length: 5 }, (_, i) => ({
            filePath: `file-${i}.tsx`,
            specifier: 'lodash',
            kind: 'unknown-specifier' as const,
            message: '',
        }));
        expect(formatPreflightShort(issues)).toBe(
            '5 imports rejected across 1 unique specifier',
        );
    });

    test('byKind is always a complete record — both keys present even when empty', () => {
        const nativeOnly = formatPreflightSummary([
            { filePath: 'A.tsx', specifier: 'react-native-reanimated', kind: 'unsupported-native', message: '' },
        ]);
        expect(nativeOnly?.byKind['unknown-specifier']).toEqual([]);

        const unknownOnly = formatPreflightSummary([
            { filePath: 'A.tsx', specifier: 'lodash', kind: 'unknown-specifier', message: '' },
        ]);
        expect(unknownOnly?.byKind['unsupported-native']).toEqual([]);
    });
});

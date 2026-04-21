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
});

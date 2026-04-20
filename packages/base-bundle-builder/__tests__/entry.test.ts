import { describe, expect, test } from 'bun:test';
import {
    createSyntheticBaseBundleEntrySource,
    SYNTHETIC_BASE_BUNDLE_ENTRY_MARKER,
} from '../src/entry';
import { listCuratedBaseBundleDependencySpecifiers } from '../src/deps';

describe('synthetic base bundle entry', () => {
    test('is deterministic and newline-stable', () => {
        const first = createSyntheticBaseBundleEntrySource();
        const second = createSyntheticBaseBundleEntrySource();

        expect(first).toBe(second);
        expect(first.endsWith('\n')).toBe(true);
        expect(first.includes('\r')).toBe(false);
    });

    test('imports each curated dependency specifier exactly once', () => {
        const specifiers = listCuratedBaseBundleDependencySpecifiers();
        const source = createSyntheticBaseBundleEntrySource();
        const importLines = source
            .split('\n')
            .filter((line) => line.startsWith('import '));

        expect(importLines).toEqual(
            specifiers.map((specifier) => `import ${JSON.stringify(specifier)};`),
        );
        expect(source).toContain(
            `globalThis.${SYNTHETIC_BASE_BUNDLE_ENTRY_MARKER} = {`,
        );
        expect(source).toContain("kind: 'synthetic-base-bundle-entry',");
        expect(source).toContain('specifiers: [');
    });
});

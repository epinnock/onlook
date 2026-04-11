import { describe, expect, it } from 'bun:test';

import {
    DEFAULT_ENTRY_CANDIDATES,
    NoEntryFoundError,
    resolveEntry,
} from '../entry-resolver';

describe('resolveEntry', () => {
    it('returns App.tsx when it is the only candidate present', () => {
        const result = resolveEntry({ paths: ['App.tsx'] });
        expect(result).toBe('App.tsx');
    });

    it('prefers index.tsx over App.tsx (priority order)', () => {
        const result = resolveEntry({
            paths: ['App.tsx', 'index.tsx', 'components/Button.tsx'],
        });
        expect(result).toBe('index.tsx');
    });

    it('resolves src/ entry candidates per the default ordering', () => {
        // DEFAULT_ENTRY_CANDIDATES lists `src/App.tsx` before `src/index.tsx`,
        // so when both are present `src/App.tsx` wins. When only
        // `src/index.tsx` is present (no top-level candidates), it is picked.
        const both = resolveEntry({
            paths: ['src/App.tsx', 'src/index.tsx'],
        });
        expect(both).toBe('src/App.tsx');

        const onlySrcIndex = resolveEntry({
            paths: ['src/index.tsx', 'components/Button.tsx'],
        });
        expect(onlySrcIndex).toBe('src/index.tsx');
    });

    it('throws NoEntryFoundError with tried + available when no candidate matches', () => {
        try {
            resolveEntry({ paths: ['weird-name.tsx', 'other.ts'] });
            throw new Error('expected resolveEntry to throw');
        } catch (err) {
            expect(err).toBeInstanceOf(NoEntryFoundError);
            const typed = err as NoEntryFoundError;
            expect(typed.name).toBe('NoEntryFoundError');
            expect(typed.tried).toEqual(DEFAULT_ENTRY_CANDIDATES);
            expect(typed.available).toContain('weird-name.tsx');
            expect(typed.available).toContain('other.ts');
            expect(typed.message).toContain('weird-name.tsx');
            expect(typed.message).toContain('No entry file found');
        }
    });

    it('throws NoEntryFoundError when paths are empty', () => {
        expect(() => resolveEntry({ paths: [] })).toThrow(NoEntryFoundError);
        try {
            resolveEntry({ paths: new Set<string>() });
            throw new Error('expected resolveEntry to throw');
        } catch (err) {
            expect(err).toBeInstanceOf(NoEntryFoundError);
            const typed = err as NoEntryFoundError;
            expect(typed.available).toEqual([]);
            expect(typed.tried).toEqual(DEFAULT_ENTRY_CANDIDATES);
        }
    });

    it('honors custom candidates when the target is present', () => {
        const result = resolveEntry({
            paths: ['main.ts', 'App.tsx'],
            candidates: ['main.ts'],
        });
        expect(result).toBe('main.ts');
    });

    it('throws when custom candidates do not match any path', () => {
        try {
            resolveEntry({
                paths: ['App.tsx', 'index.tsx'],
                candidates: ['main.ts'],
            });
            throw new Error('expected resolveEntry to throw');
        } catch (err) {
            expect(err).toBeInstanceOf(NoEntryFoundError);
            const typed = err as NoEntryFoundError;
            expect(typed.tried).toEqual(['main.ts']);
            expect(typed.available).toContain('App.tsx');
            expect(typed.available).toContain('index.tsx');
        }
    });

    it('accepts paths as a Set or an array with identical results', () => {
        const asArray = resolveEntry({ paths: ['index.ts', 'App.tsx'] });
        const asSet = resolveEntry({ paths: new Set(['index.ts', 'App.tsx']) });
        expect(asArray).toBe(asSet);
        expect(asArray).toBe('index.ts');
    });

    it('truncates the available list in the error message when >10 files', () => {
        const available: string[] = [];
        for (let i = 0; i < 15; i++) {
            available.push(`file-${i}.txt`);
        }
        try {
            resolveEntry({ paths: available });
            throw new Error('expected resolveEntry to throw');
        } catch (err) {
            expect(err).toBeInstanceOf(NoEntryFoundError);
            const typed = err as NoEntryFoundError;
            expect(typed.message).toContain('+5 more');
        }
    });
});

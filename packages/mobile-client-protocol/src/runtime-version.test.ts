import { describe, expect, test } from 'bun:test';
import {
    ONLOOK_RUNTIME_VERSION,
    isCompatible,
    parseVersion,
} from './runtime-version.ts';

describe('parseVersion', () => {
    test('parses a valid semver', () => {
        expect(parseVersion('1.2.3')).toEqual({ major: 1, minor: 2, patch: 3 });
    });

    test('parses 0.1.0', () => {
        expect(parseVersion('0.1.0')).toEqual({ major: 0, minor: 1, patch: 0 });
    });

    test('rejects missing patch', () => {
        expect(() => parseVersion('1.2')).toThrow();
    });

    test('rejects pre-release suffix (v1 simplification)', () => {
        expect(() => parseVersion('1.2.3-beta.1')).toThrow();
    });

    test('rejects non-numeric component', () => {
        expect(() => parseVersion('1.x.0')).toThrow();
    });
});

describe('isCompatible', () => {
    test('identical versions are compatible', () => {
        expect(isCompatible('0.1.0', '0.1.0')).toBe(true);
    });

    test('same major+minor, different patch is compatible', () => {
        expect(isCompatible('0.1.5', '0.1.0')).toBe(true);
        expect(isCompatible('0.1.0', '0.1.5')).toBe(true);
    });

    test('different minor is NOT compatible (v1 strict)', () => {
        expect(isCompatible('0.1.0', '0.2.0')).toBe(false);
        expect(isCompatible('0.2.0', '0.1.0')).toBe(false);
    });

    test('different major is NOT compatible', () => {
        expect(isCompatible('0.1.0', '1.1.0')).toBe(false);
        expect(isCompatible('1.0.0', '0.1.0')).toBe(false);
    });

    test('throws on invalid client semver', () => {
        expect(() => isCompatible('bogus', '0.1.0')).toThrow();
    });

    test('throws on invalid bundle semver', () => {
        expect(() => isCompatible('0.1.0', 'bogus')).toThrow();
    });
});

describe('ONLOOK_RUNTIME_VERSION constant', () => {
    test('is a parseable semver', () => {
        expect(() => parseVersion(ONLOOK_RUNTIME_VERSION)).not.toThrow();
    });

    test('is self-compatible (sanity check)', () => {
        expect(isCompatible(ONLOOK_RUNTIME_VERSION, ONLOOK_RUNTIME_VERSION)).toBe(true);
    });
});

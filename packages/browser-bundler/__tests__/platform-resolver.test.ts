import { describe, expect, test } from 'bun:test';

import {
    listPlatformResolverCandidates,
    resolvePlatformExt,
} from '../src/platform-resolver';

function existsIn(set: ReadonlySet<string>): (p: string) => boolean {
    return (p) => set.has(p);
}

describe('resolvePlatformExt', () => {
    test('prefers .ios.tsx over .native.tsx and plain .tsx', () => {
        const fs = new Set([
            '/src/Button.ios.tsx',
            '/src/Button.native.tsx',
            '/src/Button.tsx',
        ]);
        expect(
            resolvePlatformExt({
                stem: '/src/Button',
                platform: 'ios',
                fileExists: existsIn(fs),
            }),
        ).toBe('/src/Button.ios.tsx');
    });

    test('falls through .ios → .native → generic in that order', () => {
        const fs = new Set(['/src/Button.native.tsx', '/src/Button.tsx']);
        expect(
            resolvePlatformExt({
                stem: '/src/Button',
                platform: 'ios',
                fileExists: existsIn(fs),
            }),
        ).toBe('/src/Button.native.tsx');
    });

    test('falls through to generic when no platform-specific exists', () => {
        const fs = new Set(['/src/Button.tsx']);
        expect(
            resolvePlatformExt({
                stem: '/src/Button',
                platform: 'ios',
                fileExists: existsIn(fs),
            }),
        ).toBe('/src/Button.tsx');
    });

    test('advances to next extension when current is unresolvable', () => {
        const fs = new Set(['/src/Button.ts']);
        expect(
            resolvePlatformExt({
                stem: '/src/Button',
                platform: 'ios',
                fileExists: existsIn(fs),
            }),
        ).toBe('/src/Button.ts');
    });

    test('returns null when no candidate exists', () => {
        expect(
            resolvePlatformExt({
                stem: '/src/Missing',
                platform: 'ios',
                fileExists: () => false,
            }),
        ).toBeNull();
    });

    test('platform android picks .android over .native when both exist', () => {
        const fs = new Set([
            '/src/Button.android.tsx',
            '/src/Button.native.tsx',
        ]);
        expect(
            resolvePlatformExt({
                stem: '/src/Button',
                platform: 'android',
                fileExists: existsIn(fs),
            }),
        ).toBe('/src/Button.android.tsx');
    });

    test('custom extensions list is honored', () => {
        const fs = new Set(['/src/Button.mjs']);
        expect(
            resolvePlatformExt({
                stem: '/src/Button',
                platform: 'ios',
                extensions: ['mjs'],
                fileExists: existsIn(fs),
            }),
        ).toBe('/src/Button.mjs');
    });
});

describe('listPlatformResolverCandidates', () => {
    test('produces the full platform × extension grid in priority order', () => {
        const candidates = listPlatformResolverCandidates({
            stem: '/x/y',
            platform: 'ios',
            extensions: ['tsx', 'ts'],
        });
        expect(candidates).toEqual([
            '/x/y.ios.tsx',
            '/x/y.native.tsx',
            '/x/y.tsx',
            '/x/y.ios.ts',
            '/x/y.native.ts',
            '/x/y.ts',
        ]);
    });
});

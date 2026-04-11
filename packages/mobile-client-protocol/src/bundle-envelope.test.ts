import { describe, expect, test } from 'bun:test';
import { BUNDLE_FORMAT_V1, BundleEnvelopeSchema } from './bundle-envelope.ts';

const VALID_FIXTURE = {
    bundleFormat: BUNDLE_FORMAT_V1,
    onlookRuntimeVersion: '0.1.0',
    target: 'onlook-client' as const,
    source: '(async () => { /* IIFE body */ })();',
    urlImports: ['https://esm.sh/react@19.1.0'],
    entryPoint: 'App.tsx',
};

describe('BundleEnvelopeSchema', () => {
    test('round-trips a valid envelope', () => {
        const parsed = BundleEnvelopeSchema.parse(VALID_FIXTURE);
        expect(parsed.bundleFormat).toBe(BUNDLE_FORMAT_V1);
        expect(parsed.onlookRuntimeVersion).toBe('0.1.0');
        expect(parsed.target).toBe('onlook-client');
        expect(parsed.urlImports).toHaveLength(1);
        expect(parsed.entryPoint).toBe('App.tsx');
        expect(parsed.sourceMap).toBeUndefined();
    });

    test('accepts expo-go target (dual-shell path)', () => {
        const parsed = BundleEnvelopeSchema.parse({ ...VALID_FIXTURE, target: 'expo-go' });
        expect(parsed.target).toBe('expo-go');
    });

    test('rejects non-semver runtimeVersion', () => {
        expect(() =>
            BundleEnvelopeSchema.parse({ ...VALID_FIXTURE, onlookRuntimeVersion: '1.0' }),
        ).toThrow();
    });

    test('rejects wrong bundleFormat literal', () => {
        expect(() =>
            BundleEnvelopeSchema.parse({ ...VALID_FIXTURE, bundleFormat: 'metro-v1' }),
        ).toThrow();
    });

    test('rejects empty source', () => {
        expect(() =>
            BundleEnvelopeSchema.parse({ ...VALID_FIXTURE, source: '' }),
        ).toThrow();
    });

    test('rejects non-URL urlImports', () => {
        expect(() =>
            BundleEnvelopeSchema.parse({ ...VALID_FIXTURE, urlImports: ['not-a-url'] }),
        ).toThrow();
    });
});

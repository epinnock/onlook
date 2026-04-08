import { describe, expect, it } from 'bun:test';

import { buildManifestUrl, validateBundleHash } from '../manifest-url';

const VALID_HASH = 'a'.repeat(64);
const VALID_HASH_MIXED = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

describe('buildManifestUrl', () => {
    it('builds the canonical manifest URL for a LAN relay', () => {
        const url = buildManifestUrl(VALID_HASH_MIXED, {
            relayBaseUrl: 'http://192.168.1.42:8787',
        });
        expect(url).toBe(`http://192.168.1.42:8787/manifest/${VALID_HASH_MIXED}`);
    });

    it('strips a single trailing slash from relayBaseUrl', () => {
        const url = buildManifestUrl(VALID_HASH, {
            relayBaseUrl: 'http://x:8787/',
        });
        expect(url).toBe(`http://x:8787/manifest/${VALID_HASH}`);
        expect(url).not.toContain('//manifest');
    });

    it('rejects an invalid hash via validateBundleHash', () => {
        expect(() =>
            buildManifestUrl('not-a-hash', { relayBaseUrl: 'http://x:8787' }),
        ).toThrow(/invalid bundleHash/);
    });

    it('works with a deployed https relay', () => {
        const url = buildManifestUrl(VALID_HASH_MIXED, {
            relayBaseUrl: 'https://cf-expo-relay.example.workers.dev',
        });
        expect(url).toBe(
            `https://cf-expo-relay.example.workers.dev/manifest/${VALID_HASH_MIXED}`,
        );
    });
});

describe('validateBundleHash', () => {
    it('accepts a 64-char lowercase hex string', () => {
        expect(() => validateBundleHash(VALID_HASH)).not.toThrow();
        expect(() => validateBundleHash(VALID_HASH_MIXED)).not.toThrow();
    });

    it('rejects a 63-char hex string', () => {
        expect(() => validateBundleHash('a'.repeat(63))).toThrow(/invalid bundleHash/);
    });

    it('rejects a 65-char hex string', () => {
        expect(() => validateBundleHash('a'.repeat(65))).toThrow(/invalid bundleHash/);
    });

    it('rejects an uppercase hex string', () => {
        expect(() => validateBundleHash('A'.repeat(64))).toThrow(/invalid bundleHash/);
    });

    it('rejects a non-hex string of correct length', () => {
        expect(() => validateBundleHash('z'.repeat(64))).toThrow(/invalid bundleHash/);
    });

    it('rejects empty string', () => {
        expect(() => validateBundleHash('')).toThrow(/invalid bundleHash/);
    });
});

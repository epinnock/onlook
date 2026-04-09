import { describe, expect, it } from 'bun:test';

import { buildManifestUrl, toExpoScheme, validateBundleHash } from '../manifest-url';

const VALID_HASH = 'a'.repeat(64);
const VALID_HASH_MIXED = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

describe('buildManifestUrl', () => {
    it("defaults to the exp:// scheme so Expo Go's QR scanner deep-links it", () => {
        const url = buildManifestUrl(VALID_HASH_MIXED, {
            relayBaseUrl: 'http://192.168.1.42:8787',
        });
        expect(url).toBe(`exp://192.168.1.42:8787/manifest/${VALID_HASH_MIXED}`);
    });

    it("uses exps:// when the relay base is HTTPS", () => {
        const url = buildManifestUrl(VALID_HASH_MIXED, {
            relayBaseUrl: 'https://cf-expo-relay.example.workers.dev',
        });
        expect(url).toBe(
            `exps://cf-expo-relay.example.workers.dev/manifest/${VALID_HASH_MIXED}`,
        );
    });

    it("returns the raw http:// transport URL when scheme:'http' is passed", () => {
        const url = buildManifestUrl(VALID_HASH_MIXED, {
            relayBaseUrl: 'http://192.168.1.42:8787',
            scheme: 'http',
        });
        expect(url).toBe(`http://192.168.1.42:8787/manifest/${VALID_HASH_MIXED}`);
    });

    it("returns the raw https:// transport URL when scheme:'http' is passed", () => {
        const url = buildManifestUrl(VALID_HASH_MIXED, {
            relayBaseUrl: 'https://cf-expo-relay.example.workers.dev',
            scheme: 'http',
        });
        expect(url).toBe(
            `https://cf-expo-relay.example.workers.dev/manifest/${VALID_HASH_MIXED}`,
        );
    });

    it('strips a single trailing slash from relayBaseUrl (exp://)', () => {
        const url = buildManifestUrl(VALID_HASH, {
            relayBaseUrl: 'http://x:8787/',
        });
        expect(url).toBe(`exp://x:8787/manifest/${VALID_HASH}`);
        expect(url).not.toContain('//manifest');
    });

    it('strips a single trailing slash from relayBaseUrl (http override)', () => {
        const url = buildManifestUrl(VALID_HASH, {
            relayBaseUrl: 'http://x:8787/',
            scheme: 'http',
        });
        expect(url).toBe(`http://x:8787/manifest/${VALID_HASH}`);
        expect(url).not.toContain('//manifest');
    });

    it('rejects an invalid hash via validateBundleHash', () => {
        expect(() =>
            buildManifestUrl('not-a-hash', { relayBaseUrl: 'http://x:8787' }),
        ).toThrow(/invalid bundleHash/);
    });
});

describe('toExpoScheme', () => {
    it("rewrites http:// to exp://", () => {
        expect(toExpoScheme('http://192.168.0.14:8787')).toBe('exp://192.168.0.14:8787');
    });

    it("rewrites https:// to exps://", () => {
        expect(toExpoScheme('https://relay.example.com')).toBe('exps://relay.example.com');
    });

    it("returns input unchanged when it has no http(s) prefix", () => {
        expect(toExpoScheme('exp://already-set:1234')).toBe('exp://already-set:1234');
        expect(toExpoScheme('//protocol-relative')).toBe('//protocol-relative');
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

import { describe, expect, it } from 'bun:test';

import {
    buildManifestUrl,
    buildOnlookDeepLink,
    parseManifestUrl,
    toExpoScheme,
    validateBundleHash,
} from '../manifest-url';

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

describe('buildOnlookDeepLink', () => {
    it('builds an onlook://launch deep link with session and relay params', () => {
        const url = buildOnlookDeepLink(VALID_HASH_MIXED, {
            relayBaseUrl: 'http://192.168.1.42:8787',
        });
        expect(url).toStartWith('onlook://launch?');
        const parsed = new URL(url);
        expect(parsed.protocol).toBe('onlook:');
        expect(parsed.hostname).toBe('launch');
        expect(parsed.searchParams.get('session')).toBe(VALID_HASH_MIXED);
        expect(parsed.searchParams.get('relay')).toBe('http://192.168.1.42:8787');
    });

    it('URL-encodes the relay parameter', () => {
        const url = buildOnlookDeepLink(VALID_HASH, {
            relayBaseUrl: 'http://192.168.1.42:8787',
        });
        // The relay URL contains colons and slashes which must be encoded.
        expect(url).toContain('relay=http%3A%2F%2F192.168.1.42%3A8787');
    });

    it('strips a trailing slash from relayBaseUrl', () => {
        const url = buildOnlookDeepLink(VALID_HASH, {
            relayBaseUrl: 'http://x:8787/',
        });
        const parsed = new URL(url);
        expect(parsed.searchParams.get('relay')).toBe('http://x:8787');
    });

    it('works with https relay URLs', () => {
        const url = buildOnlookDeepLink(VALID_HASH, {
            relayBaseUrl: 'https://relay.example.com',
        });
        const parsed = new URL(url);
        expect(parsed.searchParams.get('relay')).toBe('https://relay.example.com');
    });

    it('rejects an invalid hash', () => {
        expect(() =>
            buildOnlookDeepLink('bad-hash', { relayBaseUrl: 'http://x:8787' }),
        ).toThrow(/invalid bundleHash/);
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

describe('parseManifestUrl (inverse of buildManifestUrl)', () => {
    it('parses an http:// manifest URL into relayBaseUrl + bundleHash', () => {
        const parsed = parseManifestUrl(
            `http://192.168.1.42:8787/manifest/${VALID_HASH_MIXED}`,
        );
        expect(parsed).toEqual({
            relayBaseUrl: 'http://192.168.1.42:8787',
            bundleHash: VALID_HASH_MIXED,
        });
    });

    it('parses an https:// manifest URL', () => {
        const parsed = parseManifestUrl(
            `https://relay.example.com/manifest/${VALID_HASH}`,
        );
        expect(parsed).toEqual({
            relayBaseUrl: 'https://relay.example.com',
            bundleHash: VALID_HASH,
        });
    });

    it('normalizes exp:// → http:// when parsing', () => {
        const parsed = parseManifestUrl(
            `exp://192.168.1.42:8787/manifest/${VALID_HASH}`,
        );
        expect(parsed).toEqual({
            relayBaseUrl: 'http://192.168.1.42:8787',
            bundleHash: VALID_HASH,
        });
    });

    it('normalizes exps:// → https:// when parsing', () => {
        const parsed = parseManifestUrl(
            `exps://relay.example.com/manifest/${VALID_HASH}`,
        );
        expect(parsed).toEqual({
            relayBaseUrl: 'https://relay.example.com',
            bundleHash: VALID_HASH,
        });
    });

    it('round-trips buildManifestUrl → parseManifestUrl exactly', () => {
        // HTTP scheme round-trip.
        const httpUrl = buildManifestUrl(VALID_HASH, {
            relayBaseUrl: 'http://192.168.1.42:8787',
            scheme: 'http',
        });
        expect(parseManifestUrl(httpUrl)).toEqual({
            relayBaseUrl: 'http://192.168.1.42:8787',
            bundleHash: VALID_HASH,
        });

        // exp:// scheme round-trip (default) — parse normalizes to http.
        const expUrl = buildManifestUrl(VALID_HASH, {
            relayBaseUrl: 'http://192.168.1.42:8787',
        });
        expect(parseManifestUrl(expUrl)).toEqual({
            relayBaseUrl: 'http://192.168.1.42:8787',
            bundleHash: VALID_HASH,
        });
    });

    it('returns null for a URL without /manifest/<hash> path', () => {
        expect(
            parseManifestUrl('http://192.168.1.42:8787/status'),
        ).toBeNull();
    });

    it('returns null for an invalid hash (not 64 hex chars)', () => {
        expect(
            parseManifestUrl('http://192.168.1.42:8787/manifest/shortHash'),
        ).toBeNull();
    });

    it('returns null for an uppercase hash (must be lowercase)', () => {
        expect(
            parseManifestUrl(`http://192.168.1.42:8787/manifest/${'A'.repeat(64)}`),
        ).toBeNull();
    });

    it('returns null for a malformed URL', () => {
        expect(parseManifestUrl('not-a-url')).toBeNull();
        expect(parseManifestUrl('')).toBeNull();
    });

    it('tolerates a trailing slash on the manifest path', () => {
        const parsed = parseManifestUrl(
            `http://127.0.0.1:8787/manifest/${VALID_HASH}/`,
        );
        expect(parsed?.bundleHash).toBe(VALID_HASH);
    });
});

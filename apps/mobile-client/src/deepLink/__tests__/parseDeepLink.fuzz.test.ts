/**
 * Fuzz / property-based edge-case tests for `parseOnlookDeepLink`.
 *
 * Complements the happy-path suite at `src/deepLink/parse.test.ts`. These
 * tests exercise malformed inputs, oversized inputs, control characters,
 * non-ASCII payloads, and schema-confusion attacks. The invariant enforced
 * across every case is:
 *
 *   1. `parseOnlookDeepLink` never throws an uncaught exception.
 *   2. It returns either a valid `ParsedDeepLink` object or `null` — never
 *      `undefined`, never a partially-built object.
 *   3. When it returns a success object, the fields match the decoded input.
 *
 * Task: MC3.3 (hardening)
 * Validate: bun --filter @onlook/mobile-client test -- parseDeepLink
 */

import { describe, expect, test } from 'bun:test';
import { parseOnlookDeepLink, type ParsedDeepLink } from '../parse';

/**
 * Invokes the parser in a way that turns any thrown exception into a test
 * failure with a readable message. Returns the parsed result so the caller
 * can make per-case assertions.
 */
function safeParse(input: string): ParsedDeepLink | null {
    try {
        return parseOnlookDeepLink(input);
    } catch (err) {
        throw new Error(
            `parseOnlookDeepLink threw on input (len=${input.length}): ${
                err instanceof Error ? err.message : String(err)
            }`,
        );
    }
}

/** Type-guard that also proves the parser didn't return `undefined`. */
function assertNullOrParsed(result: ParsedDeepLink | null): void {
    expect(result === null || (typeof result === 'object' && result !== null)).toBe(true);
    expect(result).not.toBeUndefined();
}

describe('parseOnlookDeepLink — malformed URLs', () => {
    const malformed: readonly string[] = [
        '',
        'onlook://',
        'onlook:///',
        'not-a-url',
        'http://evil.example.com',
        'https://evil.example.com/launch?session=abc&relay=http://host',
        '://missing-scheme',
        '   ',
        '\n\n',
        'onlook:',
    ];

    test.each(malformed)('rejects malformed input: %p', (input) => {
        const result = safeParse(input);
        assertNullOrParsed(result);
        expect(result).toBeNull();
    });

    test('hostname-only onlook URL returns an action (no sessionId)', () => {
        // "onlook://session" has hostname="session"; the parser treats the
        // hostname as the action. This is not a malformed URL — it is a
        // valid deep link with an `action` but no query params.
        const result = safeParse('onlook://session');
        expect(result).toEqual({ action: 'session' });
    });
});

describe('parseOnlookDeepLink — missing query params', () => {
    test('missing session AND relay returns action only', () => {
        const result = safeParse('onlook://mount');
        assertNullOrParsed(result);
        expect(result).toEqual({ action: 'mount' });
    });

    test('session present, relay absent returns action + sessionId', () => {
        const result = safeParse('onlook://mount?session=abc');
        assertNullOrParsed(result);
        expect(result).toEqual({ action: 'mount', sessionId: 'abc' });
    });

    test('relay present, session absent returns action + relay', () => {
        const result = safeParse('onlook://mount?relay=http://localhost:8787');
        assertNullOrParsed(result);
        expect(result).toEqual({ action: 'mount', relay: 'http://localhost:8787' });
    });

    test('empty string session is not coerced to undefined', () => {
        // `?session=` is a present-but-empty param. The parser returns it
        // verbatim as an empty string; Zod's `.optional()` permits that.
        const result = safeParse('onlook://mount?session=');
        assertNullOrParsed(result);
        expect(result).toEqual({ action: 'mount', sessionId: '' });
    });
});

describe('parseOnlookDeepLink — URL-encoded characters', () => {
    test('percent-encoded space and colon/slash decode correctly', () => {
        const input = 'onlook://mount?session=abc%20def&relay=wss%3A%2F%2Fhost';
        const result = safeParse(input);
        expect(result).toEqual({
            action: 'mount',
            sessionId: 'abc def',
            relay: 'wss://host',
        });
    });

    test('percent-encoded ampersand is not treated as separator', () => {
        const input = `onlook://mount?session=${encodeURIComponent('a&b=c')}&relay=http://host`;
        const result = safeParse(input);
        expect(result).toEqual({
            action: 'mount',
            sessionId: 'a&b=c',
            relay: 'http://host',
        });
    });

    test('double-encoded value is decoded exactly once', () => {
        const raw = 'abc def';
        const doubleEncoded = encodeURIComponent(encodeURIComponent(raw));
        const input = `onlook://mount?session=${doubleEncoded}`;
        const result = safeParse(input);
        // First decode yields the single-encoded form; caller would need to
        // decode again. The parser must not double-decode.
        expect(result).toEqual({
            action: 'mount',
            sessionId: encodeURIComponent(raw),
        });
    });
});

describe('parseOnlookDeepLink — control characters', () => {
    // The URL parser silently strips raw \n and \r from the input string
    // before query-string decoding, so we test both raw and percent-encoded
    // forms. Percent-encoded control chars survive decoding and must be
    // rejected by the parser (C0 controls in a sessionId indicate malformed
    // or injected input — see fix in parse.ts).

    test('raw newline in session is stripped by URL parser (not an error)', () => {
        const result = safeParse('onlook://mount?session=abc\nxyz');
        // URL strips \n from the raw URL, so the decoded sessionId is "abcxyz".
        expect(result).toEqual({ action: 'mount', sessionId: 'abcxyz' });
    });

    test('raw carriage return in session is stripped by URL parser', () => {
        const result = safeParse('onlook://mount?session=abc\rdef');
        expect(result).toEqual({ action: 'mount', sessionId: 'abcdef' });
    });

    test('percent-encoded NUL byte in session is rejected', () => {
        const result = safeParse('onlook://mount?session=abc%00def&relay=http://host');
        assertNullOrParsed(result);
        expect(result).toBeNull();
    });

    test('percent-encoded newline in session is rejected', () => {
        const result = safeParse('onlook://mount?session=abc%0Adef');
        assertNullOrParsed(result);
        expect(result).toBeNull();
    });

    test('percent-encoded carriage return in session is rejected', () => {
        const result = safeParse('onlook://mount?session=abc%0Ddef');
        assertNullOrParsed(result);
        expect(result).toBeNull();
    });

    test('percent-encoded DEL (0x7F) in session is rejected', () => {
        const result = safeParse('onlook://mount?session=abc%7Fdef');
        assertNullOrParsed(result);
        expect(result).toBeNull();
    });

    test('all C0 control bytes are rejected', () => {
        for (let byte = 0; byte <= 0x1f; byte++) {
            const hex = byte.toString(16).padStart(2, '0');
            const input = `onlook://mount?session=a%${hex}b`;
            const result = safeParse(input);
            assertNullOrParsed(result);
            expect(result).toBeNull();
        }
    });
});

describe('parseOnlookDeepLink — oversized inputs', () => {
    test('10KB sessionId is handled without throwing', () => {
        const bigSession = 'a'.repeat(10 * 1024);
        const input = `onlook://mount?session=${bigSession}&relay=http://host`;
        const start = Date.now();
        const result = safeParse(input);
        const elapsedMs = Date.now() - start;
        assertNullOrParsed(result);
        // Parser is O(n) in URL length — should be well under 100ms for 10KB.
        expect(elapsedMs).toBeLessThan(500);
        // Current behavior: accept. Assert the sessionId round-trips.
        expect(result).not.toBeNull();
        expect(result?.action).toBe('mount');
        expect(result?.sessionId).toBe(bigSession);
        expect(result?.relay).toBe('http://host');
    });

    test('100KB total URL is handled without throwing or timing out', () => {
        // ~100KB payload inside a sessionId.
        const bigSession = 'x'.repeat(100 * 1024);
        const input = `onlook://mount?session=${bigSession}&relay=http://host`;
        expect(input.length).toBeGreaterThan(100 * 1024);
        const start = Date.now();
        const result = safeParse(input);
        const elapsedMs = Date.now() - start;
        assertNullOrParsed(result);
        expect(elapsedMs).toBeLessThan(1000);
        expect(result?.sessionId?.length).toBe(100 * 1024);
    });

    test('1MB session does not crash the parser (stress)', () => {
        // Upper-bound smoke test — larger than any legitimate deep link,
        // ensures no OOM / no stack overflow / no pathological regex.
        const huge = 'y'.repeat(1024 * 1024);
        const input = `onlook://mount?session=${huge}`;
        const result = safeParse(input);
        assertNullOrParsed(result);
        // Accept or reject is fine — just must not throw.
        if (result !== null) {
            expect(result.action).toBe('mount');
            expect(result.sessionId?.length).toBe(1024 * 1024);
        }
    });
});

describe('parseOnlookDeepLink — non-ASCII inputs', () => {
    test('emoji sessionId survives round-trip via percent encoding', () => {
        const raw = 'session-🎉-id';
        const input = `onlook://mount?session=${encodeURIComponent(raw)}&relay=http://host`;
        const result = safeParse(input);
        expect(result).toEqual({
            action: 'mount',
            sessionId: raw,
            relay: 'http://host',
        });
    });

    test('CJK characters in sessionId decode correctly', () => {
        const raw = '你好世界';
        const input = `onlook://mount?session=${encodeURIComponent(raw)}`;
        const result = safeParse(input);
        expect(result).toEqual({ action: 'mount', sessionId: raw });
    });

    test('mixed script sessionId (Latin + Cyrillic + Arabic) round-trips', () => {
        const raw = 'abcПриветمرحبا';
        const input = `onlook://mount?session=${encodeURIComponent(raw)}`;
        const result = safeParse(input);
        expect(result?.sessionId).toBe(raw);
    });

    test('raw (non-percent-encoded) emoji in URL still parses', () => {
        // Some clients may hand off the URL with raw high codepoints instead
        // of percent-escaping them. The URL API accepts this in query strings.
        const input = 'onlook://mount?session=🎉';
        const result = safeParse(input);
        assertNullOrParsed(result);
        expect(result).not.toBeNull();
        expect(result?.sessionId).toBe('🎉');
    });
});

describe('parseOnlookDeepLink — schema confusion', () => {
    test('uppercase HTTPS scheme is rejected', () => {
        const result = safeParse('HTTPS://mount?session=abc&relay=http://host');
        expect(result).toBeNull();
    });

    test('uppercase ONLOOK scheme is accepted (URL normalizes to lowercase)', () => {
        // WHATWG URL parser lowercases the scheme, so `ONLOOK://` becomes
        // `onlook:`. Matching RFC 3986 §3.1 case-insensitivity, we accept it.
        const result = safeParse('ONLOOK://mount?session=abc&relay=http://host');
        expect(result).toEqual({
            action: 'mount',
            sessionId: 'abc',
            relay: 'http://host',
        });
    });

    test('mixed-case OnLoOk scheme is accepted (WHATWG normalization)', () => {
        const result = safeParse('OnLoOk://mount?session=abc&relay=http://host');
        expect(result).toEqual({
            action: 'mount',
            sessionId: 'abc',
            relay: 'http://host',
        });
    });

    test('onlook-lookalike schemes are rejected', () => {
        expect(safeParse('onlookx://mount?session=abc')).toBeNull();
        expect(safeParse('xonlook://mount?session=abc')).toBeNull();
        expect(safeParse('onloo://mount?session=abc')).toBeNull();
    });

    test('javascript: scheme is rejected (XSS defense)', () => {
        expect(safeParse('javascript://mount?session=alert(1)')).toBeNull();
        expect(safeParse('javascript:alert(1)')).toBeNull();
    });

    test('data: and file: schemes are rejected', () => {
        expect(safeParse('data:text/plain,onlook')).toBeNull();
        expect(safeParse('file:///etc/passwd')).toBeNull();
    });
});

describe('parseOnlookDeepLink — return-type invariants (property-based)', () => {
    // A coarse property test: across a broad range of string inputs the
    // parser must always return either `null` or an object matching the
    // ParsedDeepLink shape — never throw, never return `undefined`, never a
    // partially-constructed object.
    const corpus: readonly string[] = [
        '',
        ' ',
        '\u0000',
        '\uFFFF',
        'onlook://',
        'onlook://launch',
        'onlook://launch?session=a',
        'onlook://launch?relay=http://h',
        'onlook://launch?session=a&relay=http://h',
        'onlook://launch?session=' + encodeURIComponent('x\u0000y'),
        'onlook://a/b/c/d/e/f?session=x',
        'onlook://a?'.padEnd(200, 'x'),
        'onlook://a?session=' + 'q'.repeat(50_000),
        'onlook://a?session=' + encodeURIComponent('\u202Eadmin\u202D'), // bidi override
        'ONLOOK://a?session=A',
        'https://onlook.com/a?session=abc',
        'tel:+1234567890',
        'mailto:a@b.com',
        'ftp://example.com/a',
        'onlook:a:b:c',
        'onlook://user:pass@host/path?session=a',
    ];

    test.each(corpus)('invariant holds for %p', (input) => {
        const result = safeParse(input);
        // Never undefined.
        expect(result).not.toBeUndefined();
        // Either null or a well-formed object.
        if (result !== null) {
            expect(typeof result).toBe('object');
            expect(typeof result.action).toBe('string');
            expect(result.action.length).toBeGreaterThan(0);
            if (result.sessionId !== undefined) {
                expect(typeof result.sessionId).toBe('string');
                // C0 controls must never leak into the sessionId.
                expect(result.sessionId).not.toMatch(/[\u0000-\u001f\u007f]/);
            }
            if (result.relay !== undefined) {
                expect(typeof result.relay).toBe('string');
                // Zod .url() guarantees this is a syntactically valid URL.
                expect(() => new URL(result.relay as string)).not.toThrow();
            }
        }
    });
});

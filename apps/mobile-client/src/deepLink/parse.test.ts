/**
 * Tests for the Onlook deep link parser.
 *
 * Task: MC3.3
 * Validate: bun test apps/mobile-client/src/deepLink/parse.test.ts
 */

import { describe, expect, test } from 'bun:test';
import { parseOnlookDeepLink } from './parse';

describe('parseOnlookDeepLink', () => {
    test('happy path: session + relay', () => {
        const result = parseOnlookDeepLink(
            'onlook://launch?session=abc&relay=http://localhost:8787',
        );
        expect(result).toEqual({
            action: 'launch',
            sessionId: 'abc',
            relay: 'http://localhost:8787',
        });
    });

    test('missing optional params returns action only', () => {
        const result = parseOnlookDeepLink('onlook://launch');
        expect(result).toEqual({ action: 'launch' });
    });

    test('session without relay', () => {
        const result = parseOnlookDeepLink('onlook://launch?session=xyz');
        expect(result).toEqual({
            action: 'launch',
            sessionId: 'xyz',
        });
    });

    test('non-onlook scheme returns null', () => {
        expect(parseOnlookDeepLink('https://example.com/launch?session=abc')).toBeNull();
        expect(parseOnlookDeepLink('exp://launch?session=abc')).toBeNull();
        expect(parseOnlookDeepLink('myapp://launch')).toBeNull();
    });

    test('malformed URL returns null', () => {
        expect(parseOnlookDeepLink('not a url at all')).toBeNull();
        expect(parseOnlookDeepLink('://missing-scheme')).toBeNull();
        expect(parseOnlookDeepLink('onlook://')).toBeNull();
    });

    test('empty string returns null', () => {
        expect(parseOnlookDeepLink('')).toBeNull();
    });

    test('extra unknown params are ignored (not preserved)', () => {
        const result = parseOnlookDeepLink(
            'onlook://launch?session=abc&relay=http://localhost:8787&foo=bar&baz=qux',
        );
        expect(result).toEqual({
            action: 'launch',
            sessionId: 'abc',
            relay: 'http://localhost:8787',
        });
        // Verify unknown keys are not present
        expect(result).not.toHaveProperty('foo');
        expect(result).not.toHaveProperty('baz');
    });

    test('URL-encoded values are decoded correctly', () => {
        const encodedRelay = encodeURIComponent('http://relay.example.com:8787/path?key=val');
        const encodedSession = encodeURIComponent('session with spaces');
        const result = parseOnlookDeepLink(
            `onlook://launch?session=${encodedSession}&relay=${encodedRelay}`,
        );
        expect(result).toEqual({
            action: 'launch',
            sessionId: 'session with spaces',
            relay: 'http://relay.example.com:8787/path?key=val',
        });
    });

    test('settings action with no query params', () => {
        const result = parseOnlookDeepLink('onlook://settings');
        expect(result).toEqual({ action: 'settings' });
    });

    test('relay with invalid URL format is rejected', () => {
        const result = parseOnlookDeepLink('onlook://launch?session=abc&relay=not-a-url');
        // Zod .url() rejects the invalid relay, so the whole parse returns null
        expect(result).toBeNull();
    });

    test('action with subpath is parsed correctly', () => {
        const result = parseOnlookDeepLink('onlook://settings/advanced');
        expect(result).toEqual({ action: 'settings/advanced' });
    });

    test('relay param only (no session)', () => {
        const result = parseOnlookDeepLink('onlook://launch?relay=http://localhost:8787');
        expect(result).toEqual({
            action: 'launch',
            relay: 'http://localhost:8787',
        });
    });
});

/**
 * Tests for the QR barcode → deep link resolver.
 *
 * Task: MC3.7
 * Validate: bun test apps/mobile-client/src/deepLink/__tests__/qrResolver.test.ts
 */

import { describe, expect, test } from 'bun:test';
import { resolveQrCode, useQrResolver } from '../qrResolver';

describe('resolveQrCode', () => {
    test('valid onlook:// URL with session and relay resolves ok', () => {
        const result = resolveQrCode(
            'onlook://launch?session=abc123&relay=http://localhost:8787',
        );
        expect(result).toEqual({
            ok: true,
            sessionId: 'abc123',
            relay: 'http://localhost:8787',
        });
    });

    test('non-onlook URL returns error', () => {
        const result = resolveQrCode('https://example.com/launch?session=abc');
        expect(result).toEqual({
            ok: false,
            error: 'Not an Onlook QR code',
        });
    });

    test('missing sessionId returns error', () => {
        const result = resolveQrCode('onlook://launch?relay=http://localhost:8787');
        expect(result).toEqual({
            ok: false,
            error: 'QR code missing session or relay info',
        });
    });

    test('missing relay returns error', () => {
        const result = resolveQrCode('onlook://launch?session=abc123');
        expect(result).toEqual({
            ok: false,
            error: 'QR code missing session or relay info',
        });
    });

    test('empty string returns error', () => {
        const result = resolveQrCode('');
        expect(result).toEqual({
            ok: false,
            error: 'Not an Onlook QR code',
        });
    });

    test('well-formed URL with all params succeeds', () => {
        const relay = 'https://relay.onlook.dev:8787/ws';
        const result = resolveQrCode(
            `onlook://launch?session=sess-42&relay=${encodeURIComponent(relay)}`,
        );
        expect(result).toEqual({
            ok: true,
            sessionId: 'sess-42',
            relay,
        });
    });

    test('malformed string (not a URL) returns error', () => {
        const result = resolveQrCode('just random barcode text');
        expect(result).toEqual({
            ok: false,
            error: 'Not an Onlook QR code',
        });
    });

    test('onlook URL with no params returns missing-info error', () => {
        const result = resolveQrCode('onlook://launch');
        expect(result).toEqual({
            ok: false,
            error: 'QR code missing session or relay info',
        });
    });
});

describe('useQrResolver', () => {
    test('returns a resolve function that delegates to resolveQrCode', () => {
        const { resolve } = useQrResolver();
        const result = resolve(
            'onlook://launch?session=hook-test&relay=http://localhost:8787',
        );
        expect(result).toEqual({
            ok: true,
            sessionId: 'hook-test',
            relay: 'http://localhost:8787',
        });
    });
});

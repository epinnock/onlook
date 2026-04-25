import { describe, expect, test } from 'bun:test';

import { parseTwoTierManifestRoute } from '../../routes/manifest';

const LEGACY_HASH =
    'c6a1fbc03d4e7f1234567890abcdef0123456789abcdef0123456789abcdef01';

describe('two-tier manifest route contract', () => {
    test('parses a session manifest route', () => {
        const request = new Request('https://relay.example.com/manifest/session_123', {
            headers: { 'expo-platform': 'ios' },
        });

        expect(parseTwoTierManifestRoute(request)).toEqual({
            sessionId: 'session_123',
            platform: 'ios',
        });
    });

    test('keeps 64-hex manifest routes reserved for the legacy hash route', () => {
        const request = new Request(`https://relay.example.com/manifest/${LEGACY_HASH}`);

        expect(parseTwoTierManifestRoute(request)).toBeNull();
    });

    test('rejects unsupported session id characters', () => {
        const request = new Request('https://relay.example.com/manifest/session%2Fbad');

        expect(parseTwoTierManifestRoute(request)).toBeNull();
    });
});

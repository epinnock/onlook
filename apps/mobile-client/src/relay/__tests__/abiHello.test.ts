/**
 * Tests for phone-side {@link buildPhoneAbiHello}.
 *
 * The shape contract is dictated by `AbiHelloMessageSchema` in
 * `@onlook/mobile-client-protocol`. We round-trip every produced message
 * through the schema's safeParse so a spec drift surfaces as a test fail
 * here rather than a silent runtime drop on the relay's Zod gate.
 */
import { describe, expect, test } from 'bun:test';
import {
    ABI_VERSION,
    AbiHelloMessageSchema,
    type RuntimeCapabilities,
} from '@onlook/mobile-client-protocol';
import { buildPhoneAbiHello } from '../abiHello';

const validCapabilities: RuntimeCapabilities = {
    abi: 'v1',
    baseHash: 'a'.repeat(64),
    rnVersion: '0.81.6',
    expoSdk: '54.0.0',
    platform: 'ios',
    aliases: ['react', 'react-native', 'expo'],
};

describe('buildPhoneAbiHello', () => {
    test('produces a phone-role AbiHelloMessage', () => {
        const hello = buildPhoneAbiHello({
            sessionId: 'sess-1',
            capabilities: validCapabilities,
        });

        expect(hello).toEqual({
            type: 'abiHello',
            abi: ABI_VERSION,
            sessionId: 'sess-1',
            role: 'phone',
            runtime: validCapabilities,
        });
    });

    test('output round-trips through AbiHelloMessageSchema', () => {
        const hello = buildPhoneAbiHello({
            sessionId: 'sess-2',
            capabilities: validCapabilities,
        });
        const parsed = AbiHelloMessageSchema.safeParse(hello);
        expect(parsed.success).toBe(true);
    });

    test('JSON serialization round-trips through the schema', () => {
        // The relay receives messages off the wire as parsed JSON, so the
        // builder must produce a value that survives a JSON.stringify →
        // JSON.parse cycle without losing fields.
        const hello = buildPhoneAbiHello({
            sessionId: 'sess-3',
            capabilities: validCapabilities,
        });
        const wire = JSON.parse(JSON.stringify(hello));
        const parsed = AbiHelloMessageSchema.safeParse(wire);
        expect(parsed.success).toBe(true);
        if (parsed.success) {
            expect(parsed.data.role).toBe('phone');
            expect(parsed.data.sessionId).toBe('sess-3');
            expect(parsed.data.runtime.platform).toBe('ios');
        }
    });

    test('role is always "phone" — caller cannot override', () => {
        const hello = buildPhoneAbiHello({
            sessionId: 'sess-4',
            // Even if a future caller passes a runtime with a stale role
            // somewhere, the message-level role must be 'phone'.
            capabilities: { ...validCapabilities, platform: 'android' },
        });
        expect(hello.role).toBe('phone');
    });

    test('forwards platform: android', () => {
        const androidCaps: RuntimeCapabilities = {
            ...validCapabilities,
            platform: 'android',
        };
        const hello = buildPhoneAbiHello({
            sessionId: 'sess-5',
            capabilities: androidCaps,
        });
        expect(hello.runtime.platform).toBe('android');
        const parsed = AbiHelloMessageSchema.safeParse(hello);
        expect(parsed.success).toBe(true);
    });

    test('preserves the aliases array verbatim', () => {
        const aliases = ['react', 'react-native', 'expo', 'expo-router', 'expo-status-bar'];
        const hello = buildPhoneAbiHello({
            sessionId: 'sess-6',
            capabilities: { ...validCapabilities, aliases },
        });
        expect(hello.runtime.aliases).toEqual(aliases);
    });

    test('rejects empty sessionId via schema validation', () => {
        // The builder itself does not validate — sessionId emptiness is a
        // caller bug. But the schema must catch it so the relay drops the
        // message rather than wedging the handshake.
        const hello = buildPhoneAbiHello({
            sessionId: '',
            capabilities: validCapabilities,
        });
        const parsed = AbiHelloMessageSchema.safeParse(hello);
        expect(parsed.success).toBe(false);
    });
});

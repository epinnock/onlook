/**
 * Tests for the version compatibility check utility.
 *
 * Task: MC3.16
 * Validate: bun test apps/mobile-client/src/relay/__tests__/versionCheck.test.ts
 */

import { describe, expect, test } from 'bun:test';
import { ONLOOK_RUNTIME_VERSION } from '@onlook/mobile-client-protocol';
import { checkVersionCompatibility, useVersionCheck } from '../versionCheck';
import { renderHook } from './hookTestHelper';

describe('checkVersionCompatibility', () => {
    test('matching versions are compatible', () => {
        const result = checkVersionCompatibility(ONLOOK_RUNTIME_VERSION);
        expect(result.compatible).toBe(true);
    });

    test('same major+minor, different patch is compatible', () => {
        // ONLOOK_RUNTIME_VERSION is '0.1.0' — a patch bump should be compatible
        const result = checkVersionCompatibility('0.1.9');
        expect(result.compatible).toBe(true);
    });

    test('different major version is incompatible', () => {
        const result = checkVersionCompatibility('1.1.0');
        expect(result.compatible).toBe(false);
        if (!result.compatible) {
            expect(result.clientVersion).toBe(ONLOOK_RUNTIME_VERSION);
            expect(result.serverVersion).toBe('1.1.0');
            expect(result.message).toContain(ONLOOK_RUNTIME_VERSION);
            expect(result.message).toContain('1.1.0');
            expect(result.message).toContain('incompatible');
        }
    });

    test('different minor version is incompatible', () => {
        const result = checkVersionCompatibility('0.2.0');
        expect(result.compatible).toBe(false);
        if (!result.compatible) {
            expect(result.clientVersion).toBe(ONLOOK_RUNTIME_VERSION);
            expect(result.serverVersion).toBe('0.2.0');
            expect(result.message).toContain('update');
        }
    });

    test('incompatible result includes both version strings and human-readable message', () => {
        const result = checkVersionCompatibility('2.0.0');
        expect(result.compatible).toBe(false);
        if (!result.compatible) {
            expect(typeof result.clientVersion).toBe('string');
            expect(typeof result.serverVersion).toBe('string');
            expect(result.clientVersion).toBe(ONLOOK_RUNTIME_VERSION);
            expect(result.serverVersion).toBe('2.0.0');
            expect(result.message.length).toBeGreaterThan(0);
            expect(result.message).toContain('incompatible');
        }
    });
});

describe('useVersionCheck', () => {
    test('returns null when manifestVersion is undefined', () => {
        const { result } = renderHook(() => useVersionCheck(undefined));
        expect(result).toBeNull();
    });

    test('returns compatible result when versions match', () => {
        const { result } = renderHook(() =>
            useVersionCheck(ONLOOK_RUNTIME_VERSION),
        );
        expect(result).not.toBeNull();
        expect(result!.compatible).toBe(true);
    });

    test('returns incompatible result for mismatched versions', () => {
        const { result } = renderHook(() => useVersionCheck('9.9.9'));
        expect(result).not.toBeNull();
        expect(result!.compatible).toBe(false);
        if (result && !result.compatible) {
            expect(result.clientVersion).toBe(ONLOOK_RUNTIME_VERSION);
            expect(result.serverVersion).toBe('9.9.9');
        }
    });
});

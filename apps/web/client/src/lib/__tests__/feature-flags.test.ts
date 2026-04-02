import { describe, expect, it, mock, beforeEach } from 'bun:test';

// Mutable env object that the mock will return
const mockEnv = {
    NEXT_PUBLIC_ENABLED_PROVIDERS: undefined as string | undefined,
};

// Mock @/env before importing the module under test
mock.module('@/env', () => ({
    env: mockEnv,
}));

// Import after mock is registered
const { isProviderEnabled, getEnabledProviders } = await import('../feature-flags');

describe('feature-flags', () => {
    beforeEach(() => {
        mockEnv.NEXT_PUBLIC_ENABLED_PROVIDERS = undefined;
    });

    describe('isProviderEnabled', () => {
        it('defaults to codesandbox enabled when env var is unset', () => {
            expect(isProviderEnabled('codesandbox')).toBe(true);
        });

        it('defaults to cloudflare disabled when env var is unset', () => {
            expect(isProviderEnabled('cloudflare')).toBe(false);
        });

        it('enables both when env var is "cloudflare,codesandbox"', () => {
            mockEnv.NEXT_PUBLIC_ENABLED_PROVIDERS = 'cloudflare,codesandbox';
            expect(isProviderEnabled('cloudflare')).toBe(true);
            expect(isProviderEnabled('codesandbox')).toBe(true);
        });

        it('enables only cloudflare when env var is "cloudflare"', () => {
            mockEnv.NEXT_PUBLIC_ENABLED_PROVIDERS = 'cloudflare';
            expect(isProviderEnabled('cloudflare')).toBe(true);
            expect(isProviderEnabled('codesandbox')).toBe(false);
        });

        it('handles whitespace in env var', () => {
            mockEnv.NEXT_PUBLIC_ENABLED_PROVIDERS = ' cloudflare , codesandbox ';
            expect(isProviderEnabled('cloudflare')).toBe(true);
            expect(isProviderEnabled('codesandbox')).toBe(true);
        });
    });

    describe('getEnabledProviders', () => {
        it('returns default providers when env var is unset', () => {
            expect(getEnabledProviders()).toEqual(['codesandbox']);
        });

        it('returns all providers from env var', () => {
            mockEnv.NEXT_PUBLIC_ENABLED_PROVIDERS = 'cloudflare,codesandbox';
            expect(getEnabledProviders()).toEqual(['cloudflare', 'codesandbox']);
        });

        it('returns single provider from env var', () => {
            mockEnv.NEXT_PUBLIC_ENABLED_PROVIDERS = 'cloudflare';
            expect(getEnabledProviders()).toEqual(['cloudflare']);
        });

        it('returns a new array copy for defaults (no mutation leaks)', () => {
            const a = getEnabledProviders();
            const b = getEnabledProviders();
            expect(a).toEqual(b);
            expect(a).not.toBe(b);
        });
    });
});

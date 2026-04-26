/**
 * Tests for the devMenuEnabled observable + SecureStore persistence.
 *
 * `expo-secure-store` is mocked via an in-memory Map so the load/persist
 * paths run under bun:test without a native binding. Mock must be
 * registered before the module under test imports.
 */
import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';

const store = new Map<string, string>();

mock.module('expo-secure-store', () => ({
    getItemAsync: async (key: string) => store.get(key) ?? null,
    setItemAsync: async (key: string, value: string) => {
        store.set(key, value);
    },
    deleteItemAsync: async (key: string) => {
        store.delete(key);
    },
}));

const {
    DEV_MENU_ENABLED_KEY,
    __resetDevMenuEnabledForTests,
    isDevMenuEnabled,
    loadDevMenuEnabled,
    onDevMenuEnabledChange,
    setDevMenuEnabled,
} = await import('../devMenuEnabled');

beforeEach(() => {
    store.clear();
    __resetDevMenuEnabledForTests();
});

afterEach(() => {
    __resetDevMenuEnabledForTests();
});

describe('devMenuEnabled', () => {
    test('default value is false before any load', () => {
        expect(isDevMenuEnabled()).toBe(false);
    });

    test('loadDevMenuEnabled returns false when the key is absent', async () => {
        const result = await loadDevMenuEnabled();
        expect(result).toBe(false);
        expect(isDevMenuEnabled()).toBe(false);
    });

    test('loadDevMenuEnabled returns true when the key is set to "true"', async () => {
        store.set(DEV_MENU_ENABLED_KEY, 'true');
        const result = await loadDevMenuEnabled();
        expect(result).toBe(true);
        expect(isDevMenuEnabled()).toBe(true);
    });

    test('loadDevMenuEnabled returns false when the key is set to a non-true string', async () => {
        store.set(DEV_MENU_ENABLED_KEY, 'false');
        const result = await loadDevMenuEnabled();
        expect(result).toBe(false);
    });

    test('setDevMenuEnabled(true) updates state synchronously and persists', async () => {
        await setDevMenuEnabled(true);
        expect(isDevMenuEnabled()).toBe(true);
        expect(store.get(DEV_MENU_ENABLED_KEY)).toBe('true');
    });

    test('setDevMenuEnabled(false) overwrites a previously-true value', async () => {
        await setDevMenuEnabled(true);
        await setDevMenuEnabled(false);
        expect(isDevMenuEnabled()).toBe(false);
        expect(store.get(DEV_MENU_ENABLED_KEY)).toBe('false');
    });

    test('listeners fire on setDevMenuEnabled when the value changes', async () => {
        const calls: boolean[] = [];
        onDevMenuEnabledChange((v) => calls.push(v));
        await setDevMenuEnabled(true);
        await setDevMenuEnabled(false);
        expect(calls).toEqual([true, false]);
    });

    test('listeners do NOT fire on setDevMenuEnabled when the value is unchanged', async () => {
        const calls: boolean[] = [];
        onDevMenuEnabledChange((v) => calls.push(v));
        await setDevMenuEnabled(false); // same as default
        expect(calls).toEqual([]);
    });

    test('listeners fire on loadDevMenuEnabled when persisted value differs from current', async () => {
        store.set(DEV_MENU_ENABLED_KEY, 'true');
        const calls: boolean[] = [];
        onDevMenuEnabledChange((v) => calls.push(v));
        await loadDevMenuEnabled();
        expect(calls).toEqual([true]);
    });

    test('unsubscribe stops a listener from receiving further events', async () => {
        const calls: boolean[] = [];
        const off = onDevMenuEnabledChange((v) => calls.push(v));
        await setDevMenuEnabled(true);
        off();
        await setDevMenuEnabled(false);
        expect(calls).toEqual([true]);
    });

    test('multiple listeners all fire on a state change', async () => {
        const a: boolean[] = [];
        const b: boolean[] = [];
        onDevMenuEnabledChange((v) => a.push(v));
        onDevMenuEnabledChange((v) => b.push(v));
        await setDevMenuEnabled(true);
        expect(a).toEqual([true]);
        expect(b).toEqual([true]);
    });
});

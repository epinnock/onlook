/**
 * Tests for the clear-storage dev menu action (MC5.12).
 *
 * `expo-secure-store` is mocked with an in-memory Map (same pattern as
 * MC3.8's recentSessions test). The mock is registered before the modules
 * under test are dynamically imported.
 *
 * Task: MC5.12
 */

import { afterEach, describe, expect, mock, test } from 'bun:test';

// In-memory stand-in for expo-secure-store.
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

// Dynamic imports so bun picks up the mock, not the real native module.
const { clearAllStorage, createClearStorageAction } = await import(
    '../clearStorage'
);
const { addRecentSession, getRecentSessions } = await import(
    '../../storage/recentSessions'
);

// Capture console.log calls for assertion.
const logCalls: string[] = [];
const originalLog = console.log;
const logSpy = (...args: unknown[]) => {
    logCalls.push(args.map(String).join(' '));
};

afterEach(() => {
    store.clear();
    logCalls.length = 0;
    console.log = originalLog;
});

describe('clearStorage (MC5.12)', () => {
    test('clearAllStorage clears recent sessions', async () => {
        // Seed a session.
        await addRecentSession({
            sessionId: 'sess-1',
            relayHost: 'https://relay.example.com',
            lastConnected: '2026-04-10T12:00:00Z',
        });
        expect(await getRecentSessions()).toHaveLength(1);

        console.log = logSpy;
        await clearAllStorage();

        expect(await getRecentSessions()).toHaveLength(0);
    });

    test('clearAllStorage deletes known settings keys', async () => {
        // Pre-populate the two keys MC3.10 uses.
        store.set('onlook_relay_host_override', 'localhost:9999');
        store.set('onlook_dev_menu_enabled', 'true');

        console.log = logSpy;
        await clearAllStorage();

        expect(store.has('onlook_relay_host_override')).toBe(false);
        expect(store.has('onlook_dev_menu_enabled')).toBe(false);
    });

    test('clearAllStorage logs confirmation message', async () => {
        console.log = logSpy;
        await clearAllStorage();

        expect(logCalls.some((m) => m.includes('storage cleared'))).toBe(true);
        expect(
            logCalls.some((m) => m.includes('[onlook-runtime]')),
        ).toBe(true);
    });

    test('createClearStorageAction returns a destructive DevMenuAction', () => {
        const action = createClearStorageAction();

        expect(action.label).toBe('Clear Storage');
        expect(action.destructive).toBe(true);
        expect(typeof action.onPress).toBe('function');
    });

    test('action.onPress invokes clearAllStorage behaviour', async () => {
        // Seed data that should be wiped.
        store.set('onlook_relay_host_override', 'example.com');
        await addRecentSession({
            sessionId: 'sess-action',
            relayHost: 'https://relay.example.com',
            lastConnected: '2026-04-11T08:00:00Z',
        });

        console.log = logSpy;
        const action = createClearStorageAction();
        await action.onPress();

        // Sessions cleared.
        expect(await getRecentSessions()).toHaveLength(0);
        // Settings key cleared.
        expect(store.has('onlook_relay_host_override')).toBe(false);
        // Log emitted.
        expect(logCalls.some((m) => m.includes('storage cleared'))).toBe(true);
    });
});

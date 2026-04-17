/**
 * Tests for the recent sessions secure-store wrapper.
 *
 * `expo-secure-store` is a native module that cannot run under bun:test,
 * so we mock it with an in-memory Map that mirrors the async API surface.
 * The mock must be registered before the module under test is imported
 * (dynamic `import()` after `mock.module`).
 *
 * Task: MC3.8
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

// Dynamic import so bun picks up the mock, not the real native module.
const {
    addRecentSession,
    clearRecentSessions,
    getRecentSessions,
    RecentSessionSchema,
} = await import('../recentSessions');

type RecentSession = ReturnType<typeof RecentSessionSchema.parse>;

function makeSession(overrides: Partial<RecentSession> = {}): RecentSession {
    return {
        sessionId: 'sess-1',
        relayHost: 'https://relay.example.com',
        lastConnected: '2026-04-10T12:00:00Z',
        ...overrides,
    };
}

afterEach(() => {
    store.clear();
});

describe('recentSessions', () => {
    test('round-trips a single session through get/add', async () => {
        const session = makeSession();
        await addRecentSession(session);
        const sessions = await getRecentSessions();
        expect(sessions).toHaveLength(1);
        expect(sessions[0]).toEqual(session);
    });

    test('adds multiple sessions and deduplicates by sessionId', async () => {
        const s1 = makeSession({ sessionId: 'a', lastConnected: '2026-04-10T10:00:00Z' });
        const s2 = makeSession({ sessionId: 'b', lastConnected: '2026-04-10T11:00:00Z' });
        await addRecentSession(s1);
        await addRecentSession(s2);

        // Update s1 with a newer timestamp — it should replace the old entry.
        const s1Updated = makeSession({ sessionId: 'a', lastConnected: '2026-04-10T12:00:00Z' });
        await addRecentSession(s1Updated);

        const sessions = await getRecentSessions();
        expect(sessions).toHaveLength(2);
        // Most recently added first.
        expect(sessions[0]!.sessionId).toBe('a');
        expect(sessions[0]!.lastConnected).toBe('2026-04-10T12:00:00Z');
        expect(sessions[1]!.sessionId).toBe('b');
    });

    test('caps the list at 20 entries', async () => {
        for (let i = 0; i < 25; i++) {
            const minute = String(i).padStart(2, '0');
            await addRecentSession(
                makeSession({
                    sessionId: `sess-${i}`,
                    lastConnected: `2026-04-10T12:${minute}:00Z`,
                }),
            );
        }

        const sessions = await getRecentSessions();
        expect(sessions).toHaveLength(20);
        // Most recently added should be first.
        expect(sessions[0]!.sessionId).toBe('sess-24');
        // The oldest 5 (sess-0 through sess-4) should have been evicted.
        const ids = sessions.map((s) => s.sessionId);
        expect(ids).not.toContain('sess-0');
        expect(ids).not.toContain('sess-4');
    });

    test('clearRecentSessions removes all persisted data', async () => {
        await addRecentSession(makeSession());
        await clearRecentSessions();
        const sessions = await getRecentSessions();
        expect(sessions).toHaveLength(0);
    });

    test('returns empty array when stored JSON is corrupt', async () => {
        store.set('onlook_recent_sessions', '{not valid json!!!');
        const sessions = await getRecentSessions();
        expect(sessions).toEqual([]);
    });

    test('returns empty array when stored data fails Zod validation', async () => {
        // Valid JSON but missing required fields.
        const invalid = [{ sessionId: 123, relayHost: true }];
        store.set('onlook_recent_sessions', JSON.stringify(invalid));
        const sessions = await getRecentSessions();
        expect(sessions).toEqual([]);
    });

    test('returns empty array when store key does not exist', async () => {
        const sessions = await getRecentSessions();
        expect(sessions).toEqual([]);
    });

    test('RecentSessionSchema validates a well-formed object', () => {
        const result = RecentSessionSchema.safeParse({
            sessionId: 'abc',
            relayHost: 'wss://relay.example.com',
            projectName: 'My App',
            lastConnected: '2026-04-10T12:00:00Z',
        });
        expect(result.success).toBe(true);
    });

    test('RecentSessionSchema rejects an object missing required fields', () => {
        const result = RecentSessionSchema.safeParse({
            sessionId: 'abc',
            // relayHost is missing
        });
        expect(result.success).toBe(false);
    });
});

/**
 * Typed wrapper around `expo-secure-store` for persisting recent relay sessions.
 *
 * Stores up to {@link MAX_RECENT_SESSIONS} sessions in encrypted on-device
 * storage. Each entry is validated with Zod on read to guard against corrupt
 * or outdated data.
 *
 * Task: MC3.8
 */

import * as SecureStore from 'expo-secure-store';
import { z } from 'zod';

const STORE_KEY = 'onlook_recent_sessions';
const MAX_RECENT_SESSIONS = 20;

/**
 * Zod schema for a single recent relay session entry.
 */
export const RecentSessionSchema = z.object({
    sessionId: z.string().min(1),
    relayHost: z.string().min(1),
    projectName: z.string().optional(),
    lastConnected: z.string().datetime(),
});

export type RecentSession = z.infer<typeof RecentSessionSchema>;

const RecentSessionArraySchema = z.array(RecentSessionSchema);

/**
 * Read persisted recent sessions from secure storage.
 *
 * Returns an empty array when the key is missing, the stored JSON is
 * malformed, or the data fails Zod validation.
 */
export async function getRecentSessions(): Promise<RecentSession[]> {
    const raw = await SecureStore.getItemAsync(STORE_KEY);
    if (raw === null) {
        return [];
    }

    let parsed: unknown;
    try {
        parsed = JSON.parse(raw);
    } catch {
        return [];
    }

    const result = RecentSessionArraySchema.safeParse(parsed);
    if (!result.success) {
        return [];
    }

    return result.data;
}

/**
 * Add (or update) a session in the recent sessions list.
 *
 * The new session is prepended to the list. If a session with the same
 * `sessionId` already exists it is removed before prepending (dedup).
 * The list is capped at {@link MAX_RECENT_SESSIONS} entries.
 */
export async function addRecentSession(session: RecentSession): Promise<void> {
    const existing = await getRecentSessions();
    const deduped = existing.filter((s) => s.sessionId !== session.sessionId);
    const updated = [session, ...deduped].slice(0, MAX_RECENT_SESSIONS);
    await SecureStore.setItemAsync(STORE_KEY, JSON.stringify(updated));
}

/**
 * Delete all persisted recent sessions.
 */
export async function clearRecentSessions(): Promise<void> {
    await SecureStore.deleteItemAsync(STORE_KEY);
}

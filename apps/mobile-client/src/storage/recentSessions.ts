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

type ChangeListener = () => void;
const changeListeners = new Set<ChangeListener>();

function notifyChange(): void {
    for (const handler of changeListeners) {
        try {
            handler();
        } catch {
            // Listeners must not crash the writer; swallow + continue.
        }
    }
}

/**
 * Subscribe to recent-session list changes (add/clear). The handler
 * fires AFTER `addRecentSession` or `clearRecentSessions` resolves.
 * Returns an unsubscribe function. The handler is NOT invoked with the
 * current state on subscription — read via {@link getRecentSessions}
 * if the caller needs the initial value.
 *
 * Used by `RecentSessionsList` so a session added via `qrToMount`
 * automatically appears on the launcher without an app restart.
 */
export function onRecentSessionsChange(handler: ChangeListener): () => void {
    changeListeners.add(handler);
    return () => {
        changeListeners.delete(handler);
    };
}

/**
 * Add (or update) a session in the recent sessions list.
 *
 * The new session is prepended to the list. If a session with the same
 * `sessionId` already exists it is removed before prepending (dedup).
 * The list is capped at {@link MAX_RECENT_SESSIONS} entries. Notifies
 * any subscribers registered via {@link onRecentSessionsChange}.
 */
export async function addRecentSession(session: RecentSession): Promise<void> {
    const existing = await getRecentSessions();
    const deduped = existing.filter((s) => s.sessionId !== session.sessionId);
    const updated = [session, ...deduped].slice(0, MAX_RECENT_SESSIONS);
    await SecureStore.setItemAsync(STORE_KEY, JSON.stringify(updated));
    notifyChange();
}

/**
 * Delete all persisted recent sessions. Notifies any subscribers
 * registered via {@link onRecentSessionsChange}.
 */
export async function clearRecentSessions(): Promise<void> {
    await SecureStore.deleteItemAsync(STORE_KEY);
    notifyChange();
}

/**
 * Test-only helper: drop all listeners. Calling this in production is
 * a bug.
 */
export function __resetRecentSessionsListenersForTests(): void {
    changeListeners.clear();
}

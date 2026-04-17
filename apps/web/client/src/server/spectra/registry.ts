import 'server-only';

/**
 * Per-process registry mapping each authenticated user to the set of
 * Spectra simulator session ids they currently own. Used to:
 *
 * 1. Authorize the MJPEG proxy + tap/swipe routes — a user can only
 *    interact with a session they created.
 * 2. Reap idle sessions after `IDLE_TEARDOWN_MS` (see Step 6).
 *
 * Process-local by design — acceptable for single-node dev. Production
 * multi-instance would need Redis-backed storage; documented in the ADR.
 */

const IDLE_TEARDOWN_MS = 5 * 60 * 1000;

export interface SpectraSessionEntry {
    /** Opaque user id from Supabase auth — keyed off `user.id`. */
    ownerId: string;
    deviceId: string;
    createdAt: number;
    lastActivityAt: number;
}

const sessions = new Map<string, SpectraSessionEntry>();

export function registerSession(ownerId: string, deviceId: string): SpectraSessionEntry {
    const now = Date.now();
    const entry: SpectraSessionEntry = {
        ownerId,
        deviceId,
        createdAt: now,
        lastActivityAt: now,
    };
    sessions.set(deviceId, entry);
    return entry;
}

export function touchSession(deviceId: string): void {
    const entry = sessions.get(deviceId);
    if (entry) entry.lastActivityAt = Date.now();
}

export function dropSession(deviceId: string): void {
    sessions.delete(deviceId);
}

export function getSession(deviceId: string): SpectraSessionEntry | undefined {
    return sessions.get(deviceId);
}

export function assertOwnership(ownerId: string, deviceId: string): SpectraSessionEntry {
    const entry = sessions.get(deviceId);
    if (!entry) throw new Error(`Session ${deviceId} not found`);
    if (entry.ownerId !== ownerId) throw new Error(`Session ${deviceId} not owned by this user`);
    return entry;
}

export function listStaleSessions(now: number = Date.now()): SpectraSessionEntry[] {
    const stale: SpectraSessionEntry[] = [];
    for (const entry of sessions.values()) {
        if (now - entry.lastActivityAt >= IDLE_TEARDOWN_MS) stale.push(entry);
    }
    return stale;
}

/** Exposed for tests. */
export function __resetRegistryForTests(): void {
    sessions.clear();
}

export { IDLE_TEARDOWN_MS };

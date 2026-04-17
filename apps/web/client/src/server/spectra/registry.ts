// No `server-only` import here — this module is pure data (a Map + a timer)
// and the tests exercise it directly. The SpectraClient + tRPC router guard
// the boundary; the registry does not need a second wall.

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
let sweeperStarted = false;

/**
 * Start the idle sweeper on the first registration so we don't burn a
 * setInterval in tests / fresh module loads that never see a session. The
 * sweeper runs every minute and reaps entries idle ≥ IDLE_TEARDOWN_MS.
 *
 * Reaping here only drops the registry entry — the actual Spectra
 * `DELETE /v1/devices/:id` happens in a caller (cron or cleanup route) so
 * this file stays dependency-free for unit tests.
 */
const SWEEP_INTERVAL_MS = 60 * 1000;

function ensureSweeper(): void {
    if (sweeperStarted) return;
    sweeperStarted = true;
    if (typeof setInterval !== 'function') return;
    const handle = setInterval(() => {
        try {
            sweepStaleSessions();
        } catch {
            // swallow — the registry must not crash the worker process.
        }
    }, SWEEP_INTERVAL_MS);
    // Don't block process shutdown in Node.
    if (typeof (handle as any)?.unref === 'function') (handle as any).unref();
}

export function registerSession(ownerId: string, deviceId: string): SpectraSessionEntry {
    ensureSweeper();
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

/**
 * Sweep: returns the list of sessions that crossed the idle threshold, and
 * removes them from the registry in the same call. Caller is responsible
 * for actually tearing down the Spectra device — this is a pure data op.
 */
export function sweepStaleSessions(now: number = Date.now()): SpectraSessionEntry[] {
    const stale = listStaleSessions(now);
    for (const entry of stale) sessions.delete(entry.deviceId);
    return stale;
}

export { IDLE_TEARDOWN_MS };

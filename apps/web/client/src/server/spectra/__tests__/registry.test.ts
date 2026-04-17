import { beforeEach, describe, expect, test } from 'bun:test';

import {
    __resetRegistryForTests,
    assertOwnership,
    dropSession,
    getSession,
    IDLE_TEARDOWN_MS,
    listStaleSessions,
    registerSession,
    sweepStaleSessions,
    touchSession,
} from '../registry';

describe('spectra session registry', () => {
    beforeEach(() => __resetRegistryForTests());

    test('registerSession returns an entry with createdAt/lastActivityAt', () => {
        const before = Date.now();
        const entry = registerSession('user-a', 'dev-1');
        const after = Date.now();
        expect(entry.ownerId).toBe('user-a');
        expect(entry.deviceId).toBe('dev-1');
        expect(entry.createdAt).toBeGreaterThanOrEqual(before);
        expect(entry.createdAt).toBeLessThanOrEqual(after);
        expect(entry.lastActivityAt).toBe(entry.createdAt);
    });

    test('assertOwnership rejects when the caller is not the owner', () => {
        registerSession('user-a', 'dev-1');
        expect(() => assertOwnership('user-b', 'dev-1')).toThrow(/not owned/);
    });

    test('assertOwnership throws when the session is unknown', () => {
        expect(() => assertOwnership('user-a', 'dev-missing')).toThrow(/not found/);
    });

    test('touchSession bumps lastActivityAt', () => {
        registerSession('user-a', 'dev-1');
        // Pin lastActivityAt to something in the past, then confirm touch
        // raises it to "now". Avoids flakiness from Date.now() granularity.
        const entry = getSession('dev-1')!;
        entry.lastActivityAt = Date.now() - 10_000;
        touchSession('dev-1');
        expect(getSession('dev-1')!.lastActivityAt).toBeGreaterThan(entry.lastActivityAt - 1);
        expect(Date.now() - getSession('dev-1')!.lastActivityAt).toBeLessThan(1_000);
    });

    test('listStaleSessions + sweep remove idle entries', () => {
        registerSession('user-a', 'dev-stale');
        const fresh = registerSession('user-a', 'dev-fresh');
        const now = Date.now();
        // Manually age the first entry into the stale band.
        const stale = getSession('dev-stale')!;
        stale.lastActivityAt = now - IDLE_TEARDOWN_MS - 1;

        const listed = listStaleSessions(now);
        expect(listed.map((e) => e.deviceId)).toEqual(['dev-stale']);

        const swept = sweepStaleSessions(now);
        expect(swept.map((e) => e.deviceId)).toEqual(['dev-stale']);
        expect(getSession('dev-stale')).toBeUndefined();
        expect(getSession('dev-fresh')?.deviceId).toBe(fresh.deviceId);
    });

    test('dropSession clears an entry', () => {
        registerSession('user-a', 'dev-1');
        dropSession('dev-1');
        expect(getSession('dev-1')).toBeUndefined();
    });
});

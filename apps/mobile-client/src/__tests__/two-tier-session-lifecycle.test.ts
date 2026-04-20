/**
 * Two-tier session lifecycle — QR rescan must cleanly tear down the
 * previous OverlayDispatcher before starting a new one.
 *
 * App.tsx calls `handle.stop()` on the prior bootstrap then creates a
 * new one. This test asserts: the old socket is closed, the old
 * listener unregistered, and only the NEW dispatcher receives
 * subsequent overlays — no ghost listeners, no double-mount.
 */
import { describe, expect, test } from 'bun:test';

import type { OverlayDispatcher, OverlayListener } from '../relay/overlayDispatcher';
import { startTwoTierBootstrap } from '../flow/twoTierBootstrap';

class FakeDispatcher {
    started = 0;
    stopped = 0;
    private readonly listeners = new Set<OverlayListener>();

    constructor(readonly id: string) {}

    start(): void {
        this.started += 1;
    }
    stop(): void {
        this.stopped += 1;
        this.listeners.clear();
    }
    onOverlay(listener: OverlayListener): () => void {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }
    emit(code: string): void {
        for (const l of this.listeners) {
            l({ type: 'overlay', code } as Parameters<OverlayListener>[0]);
        }
    }
}

describe('two-tier session lifecycle on QR rescan', () => {
    test('stopping the previous bootstrap stops its dispatcher exactly once', () => {
        const first = new FakeDispatcher('a');
        const firstHandle = startTwoTierBootstrap({
            sessionId: 'sess-a',
            relayUrl: 'ws://relay',
            enabled: true,
            createDispatcher: () => first as unknown as OverlayDispatcher,
        });

        expect(first.started).toBe(1);
        expect(firstHandle.active).toBe(true);

        firstHandle.stop();
        expect(first.stopped).toBe(1);
        expect(firstHandle.active).toBe(false);

        // Idempotent.
        firstHandle.stop();
        expect(first.stopped).toBe(1);
    });

    test('after rescan, only the new dispatcher receives overlays', () => {
        const first = new FakeDispatcher('a');
        const second = new FakeDispatcher('b');
        const mountedOnOld: string[] = [];
        const mountedOnNew: string[] = [];

        const firstHandle = startTwoTierBootstrap({
            sessionId: 'sess-a',
            relayUrl: 'ws://relay',
            enabled: true,
            createDispatcher: () => first as unknown as OverlayDispatcher,
            mountOverlay: (code) => mountedOnOld.push(code),
        });

        first.emit('first-session-edit');
        expect(mountedOnOld).toEqual(['first-session-edit']);

        // Simulate a new QR scan: stop the old, start a new one.
        firstHandle.stop();

        const secondHandle = startTwoTierBootstrap({
            sessionId: 'sess-b',
            relayUrl: 'ws://relay',
            enabled: true,
            createDispatcher: () => second as unknown as OverlayDispatcher,
            mountOverlay: (code) => mountedOnNew.push(code),
        });

        // If the old dispatcher emitted (which it shouldn't because it's
        // stopped), the old mount callback must NOT fire, AND the new
        // dispatcher's mount callback must be isolated from it.
        first.emit('ghost-edit');
        expect(mountedOnOld).toEqual(['first-session-edit']);
        expect(mountedOnNew).toEqual([]);

        second.emit('new-session-edit');
        expect(mountedOnNew).toEqual(['new-session-edit']);
        expect(mountedOnOld).toEqual(['first-session-edit']);

        secondHandle.stop();
    });

    test('stopping the new bootstrap leaves the old (already-stopped) untouched', () => {
        const first = new FakeDispatcher('a');
        const second = new FakeDispatcher('b');

        const firstHandle = startTwoTierBootstrap({
            sessionId: 'sess-a',
            relayUrl: 'ws://relay',
            enabled: true,
            createDispatcher: () => first as unknown as OverlayDispatcher,
        });
        firstHandle.stop();

        const secondHandle = startTwoTierBootstrap({
            sessionId: 'sess-b',
            relayUrl: 'ws://relay',
            enabled: true,
            createDispatcher: () => second as unknown as OverlayDispatcher,
        });

        secondHandle.stop();
        expect(first.stopped).toBe(1);
        expect(second.stopped).toBe(1);
    });
});

import { describe, expect, test } from 'bun:test';

import {
    OverlayStatusMachine,
    OverlayStatusTransitionError,
    canTransition,
} from '../overlay-status';

describe('overlay-status', () => {
    test('starts idle and transitions through the happy path', () => {
        const m = new OverlayStatusMachine();
        expect(m.get().state).toBe('idle');
        m.transition('building');
        expect(m.get().state).toBe('building');
        m.transition('uploading-assets');
        m.transition('sent');
        m.transition('mounted');
        expect(m.get().state).toBe('mounted');
    });

    test('skipping uploading-assets is allowed (some overlays have no assets)', () => {
        const m = new OverlayStatusMachine();
        m.transition('building');
        expect(() => m.transition('sent')).not.toThrow();
    });

    test('throws OverlayStatusTransitionError on invalid transitions', () => {
        const m = new OverlayStatusMachine();
        // idle → mounted is illegal
        expect(() => m.transition('mounted')).toThrow(OverlayStatusTransitionError);
    });

    test('transition to error requires an OnlookRuntimeError payload', () => {
        const m = new OverlayStatusMachine();
        m.transition('building');
        expect(() => m.transition('error')).toThrow(/requires an OnlookRuntimeError/);
        expect(() =>
            m.transition('error', {
                error: { kind: 'overlay-parse', message: 'bad' },
            }),
        ).not.toThrow();
    });

    test('subscribe fires the current snapshot immediately and on every transition', () => {
        const m = new OverlayStatusMachine();
        const seen: string[] = [];
        const off = m.subscribe((s) => seen.push(s.state));
        m.transition('building');
        m.transition('sent');
        off();
        m.transition('mounted');
        expect(seen).toEqual(['idle', 'building', 'sent']);
    });

    test('reset returns to idle regardless of current state', () => {
        const m = new OverlayStatusMachine();
        m.transition('building');
        m.transition('sent');
        m.reset();
        expect(m.get().state).toBe('idle');
    });

    test('revision increments on every transition and reset', () => {
        const m = new OverlayStatusMachine();
        const r0 = m.get().revision;
        m.transition('building');
        expect(m.get().revision).toBe(r0 + 1);
        m.reset();
        expect(m.get().revision).toBe(r0 + 2);
    });

    test('canTransition mirrors the machine without throwing', () => {
        expect(canTransition('idle', 'building')).toBe(true);
        expect(canTransition('idle', 'mounted')).toBe(false);
        expect(canTransition('error', 'building')).toBe(true);
        expect(canTransition('mounted', 'uploading-assets')).toBe(false);
    });

    // ─── Recovery + hot-reload flows (extended coverage) ────────────────────

    test('error → idle is a valid recovery transition (bypasses rebuild)', () => {
        const m = new OverlayStatusMachine();
        m.transition('building');
        m.transition('error', { error: { kind: 'overlay-parse', message: 'bad' } });
        expect(m.get().state).toBe('error');
        expect(() => m.transition('idle')).not.toThrow();
        expect(m.get().state).toBe('idle');
    });

    test('error → building is a valid retry transition', () => {
        const m = new OverlayStatusMachine();
        m.transition('building');
        m.transition('error', { error: { kind: 'overlay-runtime', message: 'boom' } });
        expect(() => m.transition('building')).not.toThrow();
        expect(m.get().state).toBe('building');
    });

    test('mounted → building is valid (hot-reload cycle)', () => {
        const m = new OverlayStatusMachine();
        m.transition('building');
        m.transition('sent');
        m.transition('mounted');
        expect(() => m.transition('building')).not.toThrow();
    });

    test('sent → building is valid (re-edit while overlay in flight)', () => {
        const m = new OverlayStatusMachine();
        m.transition('building');
        m.transition('sent');
        expect(() => m.transition('building')).not.toThrow();
        expect(m.get().state).toBe('building');
    });

    test('sent → uploading-assets is NOT valid (asset upload must precede sent)', () => {
        expect(canTransition('sent', 'uploading-assets')).toBe(false);
        const m = new OverlayStatusMachine();
        m.transition('building');
        m.transition('sent');
        expect(() => m.transition('uploading-assets')).toThrow(
            OverlayStatusTransitionError,
        );
    });

    test('idle → sent / idle → uploading-assets are NOT valid (must build first)', () => {
        expect(canTransition('idle', 'sent')).toBe(false);
        expect(canTransition('idle', 'uploading-assets')).toBe(false);
    });

    test('mounted → sent is NOT valid (no way back except building)', () => {
        expect(canTransition('mounted', 'sent')).toBe(false);
        const m = new OverlayStatusMachine();
        m.transition('building');
        m.transition('sent');
        m.transition('mounted');
        expect(() => m.transition('sent')).toThrow(OverlayStatusTransitionError);
    });

    test('overlayHash propagates into the snapshot and reset clears it', () => {
        const m = new OverlayStatusMachine();
        m.transition('building', { overlayHash: 'a'.repeat(64) });
        expect(m.get().overlayHash).toBe('a'.repeat(64));
        m.reset();
        expect(m.get().overlayHash).toBeUndefined();
    });

    test('error payload lives on the snapshot during error state', () => {
        const err = {
            kind: 'overlay-parse' as const,
            message: 'SyntaxError',
            stack: 'at eval line 3',
        };
        const m = new OverlayStatusMachine();
        m.transition('building');
        m.transition('error', { error: err });
        const snap = m.get();
        expect(snap.state).toBe('error');
        expect(snap.error).toEqual(err);
    });

    test('transitioning out of error clears the error payload from the snapshot', () => {
        const m = new OverlayStatusMachine();
        m.transition('building');
        m.transition('error', { error: { kind: 'overlay-runtime', message: 'x' } });
        m.transition('building');
        // New snapshot: state transitioned, error should NOT be carried forward.
        expect(m.get().error).toBeUndefined();
    });

    test('subscribe unsubscribe stops firing further listeners', () => {
        const m = new OverlayStatusMachine();
        const seen: string[] = [];
        const off = m.subscribe((s) => seen.push(s.state));
        off();
        m.transition('building');
        m.transition('sent');
        expect(seen).toEqual(['idle']); // only the immediate-call fire
    });

    test('multiple subscribers each see every transition independently', () => {
        const m = new OverlayStatusMachine();
        const aSeen: string[] = [];
        const bSeen: string[] = [];
        m.subscribe((s) => aSeen.push(s.state));
        // The second subscribe() fires only its own listener once with the
        // current snapshot — it doesn't re-fire previously-registered ones.
        m.subscribe((s) => bSeen.push(s.state));
        m.transition('building');
        m.transition('sent');
        // Both see: immediate 'idle' + two transitions
        expect(aSeen).toEqual(['idle', 'building', 'sent']);
        expect(bSeen).toEqual(['idle', 'building', 'sent']);
    });

    test('constructor accepts a non-default initial state', () => {
        const m = new OverlayStatusMachine('mounted');
        expect(m.get().state).toBe('mounted');
        expect(m.get().revision).toBe(0);
    });

    test('ALLOWED_TRANSITIONS is exhaustive — every state has at least one exit', () => {
        const states = ['idle', 'building', 'uploading-assets', 'sent', 'mounted', 'error'] as const;
        for (const from of states) {
            const hasExit = states.some((to) => to !== from && canTransition(from, to));
            expect(hasExit).toBe(true);
        }
    });
});

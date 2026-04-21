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
});

import { describe, expect, test } from 'bun:test';

import { createOverlayDebouncer } from '../overlay-debounce';

interface FakeClock {
    setTimeout(fn: () => void, ms: number): unknown;
    clearTimeout(handle: unknown): void;
    advance(ms: number): void;
    pendingCount(): number;
}

function makeFakeClock(): FakeClock {
    let now = 0;
    const pending: Array<{ fireAt: number; fn: () => void; handle: symbol }> = [];
    return {
        setTimeout(fn, ms) {
            const handle = Symbol('timer');
            pending.push({ fireAt: now + ms, fn, handle });
            return handle;
        },
        clearTimeout(handle) {
            const idx = pending.findIndex((p) => p.handle === handle);
            if (idx >= 0) pending.splice(idx, 1);
        },
        advance(ms) {
            now += ms;
            // Fire timers whose fireAt has passed, in order.
            pending.sort((a, b) => a.fireAt - b.fireAt);
            while (pending.length > 0 && pending[0]!.fireAt <= now) {
                const due = pending.shift()!;
                due.fn();
            }
        },
        pendingCount() {
            return pending.length;
        },
    };
}

describe('overlay-debounce', () => {
    test('single schedule fires after the trailing window', () => {
        const clock = makeFakeClock();
        const invocations: string[] = [];
        const d = createOverlayDebouncer<string>({
            delayMs: 100,
            clock,
            invoke: (v) => {
                invocations.push(v);
            },
        });
        d.schedule('a');
        expect(d.pending).toBe(true);
        expect(invocations).toEqual([]);
        clock.advance(100);
        expect(invocations).toEqual(['a']);
        expect(d.pending).toBe(false);
    });

    test('rapid schedules collapse to the last value', () => {
        const clock = makeFakeClock();
        const invocations: string[] = [];
        const d = createOverlayDebouncer<string>({
            delayMs: 100,
            clock,
            invoke: (v) => {
                invocations.push(v);
            },
        });
        d.schedule('a');
        clock.advance(50);
        d.schedule('b');
        clock.advance(50);
        d.schedule('c');
        clock.advance(100);
        expect(invocations).toEqual(['c']);
    });

    test('cancel aborts pending invocation', () => {
        const clock = makeFakeClock();
        const invocations: string[] = [];
        const d = createOverlayDebouncer<string>({
            delayMs: 100,
            clock,
            invoke: (v) => {
                invocations.push(v);
            },
        });
        d.schedule('a');
        d.cancel();
        clock.advance(200);
        expect(invocations).toEqual([]);
        expect(d.pending).toBe(false);
    });

    test('drain resolves when no invocation is pending', async () => {
        const clock = makeFakeClock();
        const d = createOverlayDebouncer<string>({
            delayMs: 100,
            clock,
            invoke: () => {},
        });
        await expect(d.drain()).resolves.toBeUndefined();
    });

    test('drain resolves after the scheduled invocation completes', async () => {
        const clock = makeFakeClock();
        let invoked = false;
        const d = createOverlayDebouncer<string>({
            delayMs: 100,
            clock,
            invoke: () => {
                invoked = true;
            },
        });
        d.schedule('x');
        const drain = d.drain();
        clock.advance(100);
        await drain;
        expect(invoked).toBe(true);
    });

    test('cancel resolves pending drain promises', async () => {
        const clock = makeFakeClock();
        const d = createOverlayDebouncer<string>({
            delayMs: 100,
            clock,
            invoke: () => {},
        });
        d.schedule('x');
        const drain = d.drain();
        d.cancel();
        await expect(drain).resolves.toBeUndefined();
    });
});

import { describe, expect, test } from 'bun:test';

import { createOverlayPipeline } from '../overlay-pipeline';
import type { PushOverlayV1Options, PushOverlayResult } from '../push-overlay';

interface FakeClock {
    setTimeout(fn: () => void, ms: number): unknown;
    clearTimeout(handle: unknown): void;
    advance(ms: number): Promise<void>;
}

function makeFakeClock(): FakeClock {
    let now = 0;
    const pending: Array<{ fireAt: number; fn: () => void; handle: symbol }> = [];
    return {
        setTimeout(fn, ms) {
            const handle = Symbol('t');
            pending.push({ fireAt: now + ms, fn, handle });
            return handle;
        },
        clearTimeout(handle) {
            const idx = pending.findIndex((p) => p.handle === handle);
            if (idx >= 0) pending.splice(idx, 1);
        },
        async advance(ms) {
            now += ms;
            pending.sort((a, b) => a.fireAt - b.fireAt);
            while (pending.length > 0 && pending[0]!.fireAt <= now) {
                const due = pending.shift()!;
                due.fn();
                // Yield microtasks so the invoke-callback's internal awaits can flush
                // before the next scheduled timer fires.
                await Promise.resolve();
                await Promise.resolve();
            }
        },
    };
}

describe('overlay-pipeline / createOverlayPipeline', () => {
    test('schedule → debounce → build → sent on successful push', async () => {
        const clock = makeFakeClock();
        const pushCalls: PushOverlayV1Options[] = [];
        const push: typeof import('../push-overlay').pushOverlayV1 = async (opts) => {
            pushCalls.push(opts);
            return { ok: true, delivered: 1, attempts: 1 } satisfies PushOverlayResult;
        };
        const pipeline = createOverlayPipeline({
            relayBaseUrl: 'https://r',
            sessionId: 's',
            delayMs: 100,
            clock,
            push,
        });

        pipeline.schedule({
            overlay: { code: 'module.exports = {};', buildDurationMs: 5 },
        });
        expect(pipeline.status.get().state).toBe('idle');

        await clock.advance(100);
        await pipeline.drain();

        expect(pushCalls).toHaveLength(1);
        expect(pipeline.status.get().state).toBe('sent');
    });

    test('rapid schedules collapse to a single push', async () => {
        const clock = makeFakeClock();
        let pushCount = 0;
        const pipeline = createOverlayPipeline({
            relayBaseUrl: 'https://r',
            sessionId: 's',
            delayMs: 100,
            clock,
            push: async () => {
                pushCount += 1;
                return { ok: true, delivered: 1, attempts: 1 };
            },
        });

        pipeline.schedule({ overlay: { code: 'a', buildDurationMs: 1 } });
        await clock.advance(50);
        pipeline.schedule({ overlay: { code: 'b', buildDurationMs: 1 } });
        await clock.advance(50);
        pipeline.schedule({ overlay: { code: 'c', buildDurationMs: 1 } });
        await clock.advance(100);
        await pipeline.drain();

        expect(pushCount).toBe(1);
    });

    test('push failure transitions to error state', async () => {
        const clock = makeFakeClock();
        const pipeline = createOverlayPipeline({
            relayBaseUrl: 'https://r',
            sessionId: 's',
            delayMs: 50,
            clock,
            push: async () => ({ ok: false, error: 'relay responded 500', attempts: 1 }),
        });

        pipeline.schedule({ overlay: { code: 'x', buildDurationMs: 1 } });
        await clock.advance(50);
        await pipeline.drain();

        expect(pipeline.status.get().state).toBe('error');
        expect(pipeline.status.get().error?.message).toContain('500');
    });

    test('markMounted transitions sent → mounted', async () => {
        const clock = makeFakeClock();
        const pipeline = createOverlayPipeline({
            relayBaseUrl: 'https://r',
            sessionId: 's',
            delayMs: 50,
            clock,
            push: async () => ({ ok: true, delivered: 1, attempts: 1 }),
        });
        pipeline.schedule({ overlay: { code: 'x', buildDurationMs: 1 } });
        await clock.advance(50);
        await pipeline.drain();
        expect(pipeline.status.get().state).toBe('sent');
        pipeline.markMounted('hash-123');
        expect(pipeline.status.get().state).toBe('mounted');
        expect(pipeline.status.get().overlayHash).toBe('hash-123');
    });

    test('cancel before debounce fires prevents the push', async () => {
        const clock = makeFakeClock();
        let pushed = false;
        const pipeline = createOverlayPipeline({
            relayBaseUrl: 'https://r',
            sessionId: 's',
            delayMs: 100,
            clock,
            push: async () => {
                pushed = true;
                return { ok: true, delivered: 1, attempts: 1 };
            },
        });
        pipeline.schedule({ overlay: { code: 'x', buildDurationMs: 1 } });
        pipeline.cancel();
        await clock.advance(200);
        expect(pushed).toBe(false);
        expect(pipeline.status.get().state).toBe('idle');
    });

    // ─── Extended coverage — hot-reload cycles + edge cases ──────────────────

    test('assets manifest is forwarded to pushOverlayV1', async () => {
        const clock = makeFakeClock();
        const pushCalls: PushOverlayV1Options[] = [];
        const pipeline = createOverlayPipeline({
            relayBaseUrl: 'https://r',
            sessionId: 's',
            delayMs: 50,
            clock,
            push: async (opts) => {
                pushCalls.push(opts);
                return { ok: true, delivered: 1, attempts: 1 };
            },
        });
        pipeline.schedule({
            overlay: { code: 'a', buildDurationMs: 1 },
            assets: {
                abi: 'v1',
                assets: {
                    'image/abc': { kind: 'image', hash: 'abc', mime: 'image/png', uri: 'https://r/x' },
                },
            },
        });
        await clock.advance(50);
        await pipeline.drain();
        expect(pushCalls[0]?.assets?.assets['image/abc']).toBeDefined();
    });

    test('schedule after sent re-enters building (hot-reload cycle)', async () => {
        const clock = makeFakeClock();
        let pushCount = 0;
        const pipeline = createOverlayPipeline({
            relayBaseUrl: 'https://r',
            sessionId: 's',
            delayMs: 50,
            clock,
            push: async () => {
                pushCount += 1;
                return { ok: true, delivered: 1, attempts: 1 };
            },
        });
        // First push.
        pipeline.schedule({ overlay: { code: 'a', buildDurationMs: 1 } });
        await clock.advance(50);
        await pipeline.drain();
        expect(pipeline.status.get().state).toBe('sent');
        // User edits again — re-enter building.
        pipeline.schedule({ overlay: { code: 'b', buildDurationMs: 1 } });
        await clock.advance(50);
        await pipeline.drain();
        expect(pushCount).toBe(2);
        expect(pipeline.status.get().state).toBe('sent');
    });

    test('push throws (exception, not { ok: false }) transitions to error', async () => {
        const clock = makeFakeClock();
        const pipeline = createOverlayPipeline({
            relayBaseUrl: 'https://r',
            sessionId: 's',
            delayMs: 50,
            clock,
            push: async () => {
                throw new Error('fetch tore apart');
            },
        });
        pipeline.schedule({ overlay: { code: 'x', buildDurationMs: 1 } });
        await clock.advance(50);
        await pipeline.drain();
        expect(pipeline.status.get().state).toBe('error');
        expect(pipeline.status.get().error?.message).toContain('fetch tore apart');
    });

    test('markMounted from idle is a silent no-op (no illegal transition surfaced)', () => {
        const pipeline = createOverlayPipeline({
            relayBaseUrl: 'https://r',
            sessionId: 's',
            delayMs: 50,
            clock: makeFakeClock(),
            push: async () => ({ ok: true, delivered: 1, attempts: 1 }),
        });
        expect(pipeline.status.get().state).toBe('idle');
        // Calling markMounted from idle is a known no-op (tracked by the
        // internal try/catch) so stale ack messages don't bounce us into
        // an illegal state.
        expect(() => pipeline.markMounted('stale-hash')).not.toThrow();
        expect(pipeline.status.get().state).toBe('idle');
    });

    test('error → schedule again retries (debouncer is not wedged by prior failure)', async () => {
        const clock = makeFakeClock();
        let failNext = true;
        const pipeline = createOverlayPipeline({
            relayBaseUrl: 'https://r',
            sessionId: 's',
            delayMs: 50,
            clock,
            push: async () => {
                if (failNext) {
                    failNext = false;
                    return { ok: false, error: '500', attempts: 1 };
                }
                return { ok: true, delivered: 1, attempts: 1 };
            },
        });
        pipeline.schedule({ overlay: { code: 'a', buildDurationMs: 1 } });
        await clock.advance(50);
        await pipeline.drain();
        expect(pipeline.status.get().state).toBe('error');
        pipeline.schedule({ overlay: { code: 'a', buildDurationMs: 1 } });
        await clock.advance(50);
        await pipeline.drain();
        expect(pipeline.status.get().state).toBe('sent');
    });
});

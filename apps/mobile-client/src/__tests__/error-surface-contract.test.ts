/**
 * MC2.14 error-surface contract test.
 *
 * The C++ side of the runtime (`apps/mobile-client/cpp/OnlookRuntime_errorSurface.cpp`)
 * exposes two helpers:
 *
 *   - `reportRuntimeError(rt, kind, message, stack)` — posts
 *     `{kind, message, stack}` to
 *     `globalThis.OnlookRuntime.dispatchEvent('onlook:error', payload)`.
 *   - `captureAndReport(rt, fn)` — runs `fn` and routes any thrown exception
 *     through `reportRuntimeError`:
 *       * `jsi::JSError`       → kind: `'js'`     (uses err.getMessage / getStack)
 *       * `std::exception`     → kind: `'native'` (uses err.what(), stack: '')
 *       * anything else        → kind: `'unknown'` (message: 'unknown exception')
 *
 *   Commit: 9fffe1e7 wires `captureAndReport` into
 *   `OnlookRuntime_runApplication.cpp`, `OnlookRuntime_reloadBundle.cpp`, and
 *   `OnlookRuntime_dispatchEvent.cpp`.
 *
 * The real C++ `captureAndReport` is unreachable from `bun:test` on Linux
 * (requires a live Hermes runtime + JSI). This test locks the **JS-observable
 * contract** — the shape of the payload a subscriber sees via
 * `globalThis.OnlookRuntime.dispatchEvent('onlook:error', payload)`.
 *
 * Two layers of coverage:
 *
 *   1. A Zod schema (`OnlookRuntimeErrorEventSchema`) pins the wire-level
 *      shape: `{kind: 'js' | 'native' | 'unknown', message: string, stack: string}`.
 *   2. A TS-side mirror of `captureAndReport` + `reportRuntimeError` drives
 *      synthetic throws through a stubbed `globalThis.OnlookRuntime` and
 *      asserts the captured dispatch calls match the schema with the right
 *      `kind`.
 *
 * Scope: this is NOT a replacement for a Hermes-level test — the C++ impl
 * (exception catch clauses, JSI calls) still needs device-side coverage. This
 * file guards against JS-side callers that depend on the payload contract
 * drifting from what MC2.14 wires up.
 *
 * Task: MC2.14 follow-up (contract verification for commit 9fffe1e7).
 * Validate: bun --filter @onlook/mobile-client test -- error-surface
 */

import { describe, expect, test } from 'bun:test';
import { z } from 'zod';

// ── Contract schema ─────────────────────────────────────────────────────────

/**
 * JS-observable shape emitted by the C++ `reportRuntimeError`. Distinct from
 * the relay wire-level `ErrorMessageSchema` in
 * `@onlook/mobile-client-protocol/ws-messages.ts` (that one carries `react` +
 * `sessionId` + `timestamp` — it's what the listener on top of this event
 * forwards to the relay). This schema is the raw in-process event payload.
 */
const OnlookRuntimeErrorEventSchema = z.object({
    kind: z.enum(['js', 'native', 'unknown']),
    message: z.string(),
    stack: z.string(),
});
type OnlookRuntimeErrorEvent = z.infer<typeof OnlookRuntimeErrorEventSchema>;

// ── Dispatcher stub + TS mirror of captureAndReport ─────────────────────────

type DispatchCall = { name: string; payload: unknown };

function installOnlookRuntimeStub(): DispatchCall[] {
    const calls: DispatchCall[] = [];
    (globalThis as { OnlookRuntime?: unknown }).OnlookRuntime = {
        dispatchEvent(name: string, payload: unknown) {
            calls.push({ name, payload });
        },
    };
    return calls;
}

function uninstallOnlookRuntimeStub(): void {
    delete (globalThis as { OnlookRuntime?: unknown }).OnlookRuntime;
}

/**
 * JS mirror of C++ `reportRuntimeError` (OnlookRuntime_errorSurface.cpp:13).
 * Identical control flow: bail if `globalThis.OnlookRuntime.dispatchEvent`
 * isn't callable, otherwise call it with `('onlook:error', {kind, message,
 * stack})`. Any throw from the dispatcher itself is swallowed.
 */
function reportRuntimeError(kind: string, message: string, stack: string): void {
    try {
        const runtime = (globalThis as { OnlookRuntime?: { dispatchEvent?: unknown } })
            .OnlookRuntime;
        if (!runtime) return;
        const dispatch = runtime.dispatchEvent;
        if (typeof dispatch !== 'function') return;
        (dispatch as (n: string, p: unknown) => void).call(
            runtime,
            'onlook:error',
            { kind, message, stack },
        );
    } catch {
        /* swallow — reportRuntimeError must not throw */
    }
}

/**
 * JS mirror of C++ `captureAndReport` (OnlookRuntime_errorSurface.cpp:33).
 * TS doesn't have distinct `jsi::JSError` vs `std::exception` — we model the
 * three catch arms by treating: Error with a non-empty `stack` as the "js"
 * arm (mirroring `jsi::JSError.getStack`), Error with empty/missing stack as
 * the "native" arm (mirroring `std::exception::what()` with empty stack),
 * and a non-Error thrown value as "unknown".
 */
function captureAndReport(fn: () => void): void {
    try {
        fn();
    } catch (err: unknown) {
        if (err instanceof Error) {
            if (typeof err.stack === 'string' && err.stack.length > 0) {
                reportRuntimeError('js', err.message, err.stack);
            } else {
                reportRuntimeError('native', err.message, '');
            }
        } else {
            reportRuntimeError('unknown', 'unknown exception', '');
        }
    }
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe('onlook:error event — payload shape contract (MC2.14)', () => {
    test('OnlookRuntimeErrorEventSchema accepts the documented shape', () => {
        const parsed = OnlookRuntimeErrorEventSchema.parse({
            kind: 'js',
            message: 'boom',
            stack: 'at Foo (bundle.js:1:1)',
        });
        expect(parsed.kind).toBe('js');
        expect(parsed.message).toBe('boom');
        expect(parsed.stack).toBe('at Foo (bundle.js:1:1)');
    });

    test('rejects unknown kind values', () => {
        expect(() =>
            OnlookRuntimeErrorEventSchema.parse({
                kind: 'react', // wire-level kind; not a runtime-event kind
                message: 'm',
                stack: '',
            }),
        ).toThrow();
    });

    test('rejects missing fields', () => {
        expect(() =>
            OnlookRuntimeErrorEventSchema.parse({ kind: 'js', message: 'm' }),
        ).toThrow();
    });
});

describe('captureAndReport → OnlookRuntime.dispatchEvent plumbing', () => {
    test('throws inside captureAndReport surface as onlook:error with kind=js', () => {
        const calls = installOnlookRuntimeStub();
        try {
            captureAndReport(() => {
                throw new Error('bundle eval failed');
            });

            expect(calls).toHaveLength(1);
            const [call] = calls;
            expect(call).toBeDefined();
            expect(call!.name).toBe('onlook:error');

            const payload = OnlookRuntimeErrorEventSchema.parse(call!.payload);
            expect(payload.kind).toBe('js');
            expect(payload.message).toBe('bundle eval failed');
            expect(payload.stack.length).toBeGreaterThan(0);
        } finally {
            uninstallOnlookRuntimeStub();
        }
    });

    test('non-Error thrown value routes through kind=unknown', () => {
        const calls = installOnlookRuntimeStub();
        try {
            captureAndReport(() => {
                // Mirrors the `catch (...)` arm in C++ captureAndReport — a
                // non-`jsi::JSError` / non-`std::exception` throwable.
                // eslint-disable-next-line @typescript-eslint/no-throw-literal
                throw 'string thrown like a pleb';
            });

            expect(calls).toHaveLength(1);
            const payload = OnlookRuntimeErrorEventSchema.parse(calls[0]!.payload);
            expect(payload.kind).toBe('unknown');
            expect(payload.message).toBe('unknown exception');
            expect(payload.stack).toBe('');
        } finally {
            uninstallOnlookRuntimeStub();
        }
    });

    test('Error with no stack routes through kind=native', () => {
        const calls = installOnlookRuntimeStub();
        try {
            captureAndReport(() => {
                // Mirrors the `catch (const std::exception&)` arm — native
                // exception carries a `what()` message but no JS stack.
                const err = new Error('libc++ abort: bad_alloc');
                err.stack = '';
                throw err;
            });

            expect(calls).toHaveLength(1);
            const payload = OnlookRuntimeErrorEventSchema.parse(calls[0]!.payload);
            expect(payload.kind).toBe('native');
            expect(payload.message).toBe('libc++ abort: bad_alloc');
            expect(payload.stack).toBe('');
        } finally {
            uninstallOnlookRuntimeStub();
        }
    });

    test('no error → no dispatch (happy path is silent)', () => {
        const calls = installOnlookRuntimeStub();
        try {
            captureAndReport(() => {
                // nothing thrown
            });
            expect(calls).toHaveLength(0);
        } finally {
            uninstallOnlookRuntimeStub();
        }
    });

    test('reportRuntimeError is a no-op when OnlookRuntime is absent', () => {
        // Mirrors the C++ guard at OnlookRuntime_errorSurface.cpp:17 — the
        // helper must not throw even if the JSI binding hasn't installed
        // `globalThis.OnlookRuntime` yet.
        uninstallOnlookRuntimeStub();
        expect(() => reportRuntimeError('js', 'm', 's')).not.toThrow();
    });

    test('reportRuntimeError is a no-op when dispatchEvent is not a function', () => {
        // Mirrors the `!dispatchVal.isObject() || !isFunction` guard at
        // OnlookRuntime_errorSurface.cpp:20. Setting dispatchEvent to a
        // non-function must not trigger a throw.
        (globalThis as { OnlookRuntime?: unknown }).OnlookRuntime = {
            dispatchEvent: 'not a function',
        };
        try {
            expect(() => reportRuntimeError('js', 'm', 's')).not.toThrow();
        } finally {
            uninstallOnlookRuntimeStub();
        }
    });

    test('dispatcher throwing is swallowed (reportRuntimeError never throws)', () => {
        // Mirrors the outer `try/catch (...)` at
        // OnlookRuntime_errorSurface.cpp:15,29. A pathological listener that
        // throws on `onlook:error` must not propagate out of reportRuntimeError.
        (globalThis as { OnlookRuntime?: unknown }).OnlookRuntime = {
            dispatchEvent() {
                throw new Error('listener blew up');
            },
        };
        try {
            expect(() =>
                captureAndReport(() => {
                    throw new Error('inner');
                }),
            ).not.toThrow();
        } finally {
            uninstallOnlookRuntimeStub();
        }
    });

    test('payload reaches dispatcher as the second positional arg', () => {
        // Locks the `(name, payload)` call convention from
        // OnlookRuntime_errorSurface.cpp:25-28. The C++ uses callWithThis
        // with two args; JS subscribers must receive them in that order.
        const calls = installOnlookRuntimeStub();
        try {
            reportRuntimeError('js', 'hello', 'at x (a.js:1:1)');
            expect(calls).toHaveLength(1);
            expect(calls[0]!.name).toBe('onlook:error');
            const payload = calls[0]!.payload as OnlookRuntimeErrorEvent;
            expect(payload.kind).toBe('js');
            expect(payload.message).toBe('hello');
            expect(payload.stack).toBe('at x (a.js:1:1)');
        } finally {
            uninstallOnlookRuntimeStub();
        }
    });
});

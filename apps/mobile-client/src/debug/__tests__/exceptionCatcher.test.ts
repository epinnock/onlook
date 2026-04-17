/**
 * Tests for the native JS exception catcher.
 *
 * Task: MC5.7
 * Validate: bun test apps/mobile-client/src/debug/__tests__/exceptionCatcher.test.ts
 */

import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import { ExceptionCatcher } from '../exceptionCatcher';
import type { ExceptionEntry } from '../exceptionCatcher';

/** Minimal shape matching React Native's ErrorUtils. */
interface MockErrorUtils {
    setGlobalHandler: (handler: (error: Error, isFatal?: boolean) => void) => void;
    getGlobalHandler: () => ((error: Error, isFatal?: boolean) => void) | undefined;
    /** Test helper: the currently-installed handler. */
    __current?: (error: Error, isFatal?: boolean) => void;
    /** Test helper: simulate an unhandled exception. */
    __fire: (error: Error, isFatal?: boolean) => void;
}

/** Build a fresh mock ErrorUtils object. */
function createMockErrorUtils(): MockErrorUtils {
    const eu: MockErrorUtils = {
        setGlobalHandler(handler) {
            eu.__current = handler;
        },
        getGlobalHandler() {
            return eu.__current;
        },
        __fire(error: Error, isFatal?: boolean) {
            eu.__current?.(error, isFatal);
        },
    };
    return eu;
}

describe('ExceptionCatcher', () => {
    let catcher: ExceptionCatcher;
    let mockErrorUtils: MockErrorUtils;

    // Stash originals so we can restore after each test.
    let originalErrorUtils: unknown;
    let originalConsoleError: typeof console.error;
    const hadWindow = 'window' in globalThis;
    let originalWindow: unknown;

    beforeEach(() => {
        originalErrorUtils = (globalThis as { ErrorUtils?: unknown }).ErrorUtils;
        originalConsoleError = console.error;
        originalWindow = (globalThis as { window?: unknown }).window;

        mockErrorUtils = createMockErrorUtils();
        (globalThis as { ErrorUtils?: MockErrorUtils }).ErrorUtils = mockErrorUtils;

        // Silence console.error in tests — the catcher logs captured errors.
        console.error = mock(() => {});

        // Ensure there is no stray `window` global confusing the catcher.
        if (!hadWindow) {
            delete (globalThis as { window?: unknown }).window;
        }

        catcher = new ExceptionCatcher();
    });

    afterEach(() => {
        catcher.uninstall();

        console.error = originalConsoleError;

        if (originalErrorUtils === undefined) {
            delete (globalThis as { ErrorUtils?: unknown }).ErrorUtils;
        } else {
            (globalThis as { ErrorUtils?: unknown }).ErrorUtils = originalErrorUtils;
        }

        if (hadWindow) {
            (globalThis as { window?: unknown }).window = originalWindow;
        } else {
            delete (globalThis as { window?: unknown }).window;
        }
    });

    test('install patches ErrorUtils.setGlobalHandler', () => {
        expect(mockErrorUtils.__current).toBeUndefined();

        catcher.install();

        expect(typeof mockErrorUtils.__current).toBe('function');
    });

    test('unhandled JS error from ErrorUtils is captured into the buffer', () => {
        catcher.install();

        const err = new Error('hermes boom');
        mockErrorUtils.__fire(err, true);

        const buffer = catcher.getBuffer();
        expect(buffer).toHaveLength(1);
        expect(buffer[0]!.message).toBe('hermes boom');
        expect(buffer[0]!.kind).toBe('js');
        expect(buffer[0]!.componentStack).toBeNull();
        expect(buffer[0]!.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
        // Stack should be present (Error includes one on construction).
        expect(buffer[0]!.stack).toBeTruthy();
    });

    test('captured exceptions are logged with the [onlook-runtime] prefix', () => {
        const errorSpy = mock(() => {});
        console.error = errorSpy;

        catcher.install();
        mockErrorUtils.__fire(new Error('prefixed'), false);

        expect(errorSpy).toHaveBeenCalled();
        const firstArg = errorSpy.mock.calls[0]![0] as string;
        expect(firstArg).toContain('[onlook-runtime]');
        expect(firstArg).toContain('uncaught exception');
    });

    test('original ErrorUtils handler is still invoked after capture', () => {
        const priorHandler = mock(() => {});
        // Seed a pre-existing handler — catcher should preserve it.
        mockErrorUtils.setGlobalHandler(priorHandler);

        catcher.install();

        const err = new Error('preserve me');
        mockErrorUtils.__fire(err, true);

        expect(priorHandler).toHaveBeenCalledTimes(1);
        expect(priorHandler).toHaveBeenCalledWith(err, true);
    });

    test('captureException records manual errors with componentStack', () => {
        catcher.install();

        const err = new Error('boundary caught');
        catcher.captureException(err, '\n  in App\n  in Root');

        const buffer = catcher.getBuffer();
        expect(buffer).toHaveLength(1);
        expect(buffer[0]!.message).toBe('boundary caught');
        expect(buffer[0]!.componentStack).toBe('\n  in App\n  in Root');
        expect(buffer[0]!.kind).toBe('js');
    });

    test('captureException works without an install()', () => {
        // ErrorBoundary may call captureException even before install runs.
        const err = new Error('pre-install');
        catcher.captureException(err);

        const buffer = catcher.getBuffer();
        expect(buffer).toHaveLength(1);
        expect(buffer[0]!.message).toBe('pre-install');
        expect(buffer[0]!.componentStack).toBeNull();
    });

    test('uninstall restores the original ErrorUtils handler', () => {
        const priorHandler = mock(() => {});
        mockErrorUtils.setGlobalHandler(priorHandler);

        catcher.install();
        // Patched handler should differ from the prior one.
        expect(mockErrorUtils.__current).not.toBe(priorHandler);

        catcher.uninstall();

        expect(mockErrorUtils.__current).toBe(priorHandler);
    });

    test('uninstall is safe when not installed', () => {
        expect(() => catcher.uninstall()).not.toThrow();
    });

    test('install is idempotent (second call is a no-op)', () => {
        catcher.install();
        const firstHandler = mockErrorUtils.__current;
        catcher.install();
        expect(mockErrorUtils.__current).toBe(firstHandler);
    });

    test('listener receives captured exceptions', () => {
        const received: ExceptionEntry[] = [];
        catcher.onException((entry) => received.push(entry));
        catcher.install();

        mockErrorUtils.__fire(new Error('listener-test'), false);

        expect(received).toHaveLength(1);
        expect(received[0]!.message).toBe('listener-test');
        expect(received[0]!.kind).toBe('js');
    });

    test('unsubscribe stops delivery to that listener', () => {
        const received: ExceptionEntry[] = [];
        const unsub = catcher.onException((entry) => received.push(entry));
        catcher.install();

        mockErrorUtils.__fire(new Error('first'));
        expect(received).toHaveLength(1);

        unsub();

        mockErrorUtils.__fire(new Error('second'));
        expect(received).toHaveLength(1);
    });

    test('listener errors do not prevent buffer push or other listeners', () => {
        const received: ExceptionEntry[] = [];
        catcher.onException(() => {
            throw new Error('listener exploded');
        });
        catcher.onException((entry) => received.push(entry));

        catcher.install();
        mockErrorUtils.__fire(new Error('bang'));

        // Second listener ran and buffer still got the entry.
        expect(received).toHaveLength(1);
        expect(catcher.getBuffer()).toHaveLength(1);
    });

    test('buffer caps at 50 entries and keeps the most recent', () => {
        catcher.install();
        for (let i = 0; i < 75; i++) {
            mockErrorUtils.__fire(new Error(`err-${i}`));
        }

        const buffer = catcher.getBuffer();
        expect(buffer).toHaveLength(50);
        // Oldest 25 should have been evicted.
        expect(buffer[0]!.message).toBe('err-25');
        expect(buffer[49]!.message).toBe('err-74');
    });

    test('clearBuffer empties the buffer', () => {
        catcher.install();
        mockErrorUtils.__fire(new Error('a'));
        mockErrorUtils.__fire(new Error('b'));
        expect(catcher.getBuffer()).toHaveLength(2);

        catcher.clearBuffer();
        expect(catcher.getBuffer()).toHaveLength(0);
    });

    test('install is a no-op when ErrorUtils is absent', () => {
        delete (globalThis as { ErrorUtils?: unknown }).ErrorUtils;

        const absent = new ExceptionCatcher();
        expect(() => absent.install()).not.toThrow();

        // Manual captureException should still work.
        absent.captureException(new Error('fallback'));
        expect(absent.getBuffer()).toHaveLength(1);

        absent.uninstall();
    });
});

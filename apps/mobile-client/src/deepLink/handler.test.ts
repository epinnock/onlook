/**
 * Tests for the Onlook deep link handler.
 *
 * Task: MC3.4
 * Validate: bun test apps/mobile-client/src/deepLink/handler.test.ts
 */

import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';

// ---------------------------------------------------------------------------
// Mock react-native's Linking module.
//
// IMPORTANT: mock.module must be called BEFORE importing the module under test
// so that Bun intercepts the `react-native` import and never tries to parse
// the real Flow-typed entry point.
// ---------------------------------------------------------------------------

type UrlListener = (event: { url: string }) => void;

let mockInitialURL: string | null = null;
let urlListeners: UrlListener[] = [];
let removeCallCount = 0;

const mockRemove = mock(() => {
    removeCallCount++;
});

// Shared comprehensive mock prevents cross-file pollution — see
// src/__tests__/helpers/rnMock.ts. Local override replaces Linking
// so the test can control deep-link emission.
import { rnMockStubs } from '../__tests__/helpers/rnMock';

mock.module('react-native', () => ({
    ...rnMockStubs(),
    Linking: {
        getInitialURL: () => Promise.resolve(mockInitialURL),
        addEventListener: (_event: string, handler: UrlListener) => {
            if (_event === 'url') {
                urlListeners.push(handler);
            }
            return { remove: mockRemove };
        },
    },
}));

// ---------------------------------------------------------------------------
// Mock react — provide useEffect and the minimum hooks other files need.
// ---------------------------------------------------------------------------
//
// Same process-wide-mock-pollution concern as react-native above —
// any narrow `mock.module('react', ...)` here leaks to every subsequent
// test file in the `bun test` run. Downstream files like versionCheck
// use `useMemo` through renderHook, so we include it (and the other
// common hooks) here even though this test itself only needs useEffect.

let cleanupFn: (() => void) | undefined;

// hookTestHelper.ts (used by versionCheck.test.ts) needs React 19's
// client internals slot to inject a synchronous dispatcher. Expose a
// mutable `H` holder so the helper can swap it without crashing.
const reactInternals = { H: null as unknown };

const reactStubs = {
    __CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE:
        reactInternals,
    useEffect: (effect: () => (() => void) | void) => {
        const result = effect();
        if (typeof result === 'function') {
            cleanupFn = result;
        }
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    useMemo: <T,>(factory: () => T, _deps?: any[]): T => factory(),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    useState: <T,>(init: T | (() => T)): [T, (v: T) => void] => [
        typeof init === 'function' ? (init as () => T)() : init,
        () => {},
    ],
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    useCallback: <T extends (...a: any[]) => any>(fn: T, _deps?: any[]): T => fn,
    useRef: <T,>(init: T): { current: T } => ({ current: init }),
    useContext: <T,>(_ctx: unknown): T => undefined as unknown as T,
    createContext: <T,>(defaultValue: T): unknown => ({
        Provider: ({ children }: { children: unknown }) => children,
        Consumer: ({ children }: { children: (v: T) => unknown }) =>
            children(defaultValue),
        _defaultValue: defaultValue,
    }),
    Fragment: ({ children }: { children?: unknown }) => children,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    createElement: (..._args: any[]): unknown => null,
};

// Some consumers do `import React from 'react'` which needs a default
// export with the same shape, so expose the stub as BOTH named exports
// and the `default` export.
mock.module('react', () => ({
    ...reactStubs,
    default: reactStubs,
}));

// ---------------------------------------------------------------------------
// Import the module under test AFTER mocks are registered.
// ---------------------------------------------------------------------------

const { registerDeepLinkHandler, useDeepLinkHandler } = await import('./handler');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Flush microtask queue so `.then()` on getInitialURL resolves. */
function flushMicrotasks(): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, 0));
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('registerDeepLinkHandler', () => {
    beforeEach(() => {
        mockInitialURL = null;
        urlListeners = [];
        removeCallCount = 0;
        cleanupFn = undefined;
    });

    test('cold-start: initial URL is parsed and forwarded', async () => {
        mockInitialURL = 'onlook://launch?session=cold123&relay=http://localhost:8787';
        const received: unknown[] = [];
        registerDeepLinkHandler((parsed) => received.push(parsed));

        await flushMicrotasks();

        expect(received).toHaveLength(1);
        expect(received[0]).toEqual({
            action: 'launch',
            sessionId: 'cold123',
            relay: 'http://localhost:8787',
        });
    });

    test('warm-start: URL event fires after mount and is forwarded', async () => {
        mockInitialURL = null;
        const received: unknown[] = [];
        registerDeepLinkHandler((parsed) => received.push(parsed));

        await flushMicrotasks();

        // Simulate a deep link arriving while the app is running.
        expect(urlListeners).toHaveLength(1);
        urlListeners[0]({ url: 'onlook://settings' });

        expect(received).toHaveLength(1);
        expect(received[0]).toEqual({ action: 'settings' });
    });

    test('non-onlook URL is ignored', async () => {
        mockInitialURL = 'https://example.com/not-onlook';
        const received: unknown[] = [];
        registerDeepLinkHandler((parsed) => received.push(parsed));

        await flushMicrotasks();

        // Cold-start URL should be ignored.
        expect(received).toHaveLength(0);

        // Warm-start non-onlook URL should also be ignored.
        urlListeners[0]({ url: 'myapp://other' });
        expect(received).toHaveLength(0);
    });

    test('unsubscribe removes the listener', () => {
        const unsubscribe = registerDeepLinkHandler(() => {});
        expect(removeCallCount).toBe(0);

        unsubscribe();

        expect(removeCallCount).toBe(1);
    });

    test('null initial URL is handled gracefully', async () => {
        mockInitialURL = null;
        const received: unknown[] = [];
        registerDeepLinkHandler((parsed) => received.push(parsed));

        await flushMicrotasks();

        // No link should be forwarded.
        expect(received).toHaveLength(0);
    });

    test('malformed initial URL is ignored', async () => {
        mockInitialURL = 'onlook://';
        const received: unknown[] = [];
        registerDeepLinkHandler((parsed) => received.push(parsed));

        await flushMicrotasks();

        expect(received).toHaveLength(0);
    });

    test('multiple warm-start events are each forwarded independently', async () => {
        mockInitialURL = null;
        const received: unknown[] = [];
        registerDeepLinkHandler((parsed) => received.push(parsed));

        await flushMicrotasks();

        urlListeners[0]({ url: 'onlook://launch?session=a' });
        urlListeners[0]({ url: 'onlook://launch?session=b' });

        expect(received).toHaveLength(2);
        expect((received[0] as { sessionId: string }).sessionId).toBe('a');
        expect((received[1] as { sessionId: string }).sessionId).toBe('b');
    });
});

describe('useDeepLinkHandler', () => {
    beforeEach(() => {
        mockInitialURL = null;
        urlListeners = [];
        removeCallCount = 0;
        cleanupFn = undefined;
    });

    test('registers handler on mount and cleans up on unmount', async () => {
        const received: unknown[] = [];
        useDeepLinkHandler((parsed) => received.push(parsed));

        await flushMicrotasks();

        // The hook should have registered via useEffect — our mock calls it
        // immediately, so the url listener should be in place.
        expect(urlListeners).toHaveLength(1);

        // Simulate a link event.
        urlListeners[0]({ url: 'onlook://launch?session=hook1' });
        expect(received).toHaveLength(1);

        // Simulate unmount by calling the cleanup function.
        expect(cleanupFn).toBeDefined();
        cleanupFn!();
        expect(removeCallCount).toBe(1);
    });
});

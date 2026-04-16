/**
 * Minimal synchronous renderHook helper for bun:test.
 *
 * In a React Native project without react-dom or @testing-library, we
 * temporarily inject a minimal hook dispatcher into React's internals so
 * hooks like `useMemo` execute synchronously outside a component tree.
 *
 * Only supports: useMemo, useRef, useCallback, useState (synchronous hooks).
 * Does NOT support: useEffect, useLayoutEffect, or any async state updates.
 */

import React from 'react';

// React 19 renamed internals. Try the new name first, then fall back.
const internals: { H?: unknown } | undefined =
    (React as Record<string, unknown>)
        .__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE as
        | { H?: unknown }
        | undefined;

/** Minimal dispatcher that supports useMemo (calls factory directly). */
const syncDispatcher = {
    useMemo<T>(factory: () => T, _deps: unknown[]): T {
        return factory();
    },
    useRef<T>(initialValue: T): { current: T } {
        return { current: initialValue };
    },
    useCallback<T>(callback: T, _deps: unknown[]): T {
        return callback;
    },
    useState<T>(initial: T | (() => T)): [T, (v: T) => void] {
        const value = typeof initial === 'function' ? (initial as () => T)() : initial;
        return [value, () => {}];
    },
    useReducer<T>(reducer: unknown, initial: T): [T, () => void] {
        return [initial, () => {}];
    },
    useContext<T>(context: React.Context<T>): T {
        return (context as unknown as { _currentValue: T })._currentValue;
    },
    useDebugValue: () => {},
};

/**
 * Synchronously render a hook and return its result.
 *
 * @param hookFn - A function that calls the hook, e.g. `() => useMyHook(arg)`.
 * @returns `{ result }` where `result` is the hook's return value.
 */
export function renderHook<T>(hookFn: () => T): { result: T } {
    if (!internals || !('H' in internals)) {
        throw new Error(
            'React internals not available — cannot run hooks outside a component',
        );
    }

    const prev = internals.H;
    try {
        internals.H = syncDispatcher;
        const result = hookFn();
        return { result };
    } finally {
        internals.H = prev;
    }
}

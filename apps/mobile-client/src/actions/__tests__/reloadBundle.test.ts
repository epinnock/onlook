/**
 * Tests for the reload bundle dev menu action.
 *
 * Task: MC5.11
 * Validate: bun test apps/mobile-client/src/actions/__tests__/reloadBundle.test.ts
 */

import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import { rnMockStubs } from '../../__tests__/helpers/rnMock';

// ── Mock react-native DevSettings before importing the module under test ──
//
// Uses the shared `rnMockStubs()` comprehensive stub so this file's mock
// doesn't corrupt subsequent test files that import other react-native
// symbols (Alert, FlatList, ActivityIndicator, etc.). bun's mock.module
// is process-wide with no restore hook, so whatever this installs is
// visible everywhere — it MUST include every symbol used anywhere in
// apps/mobile-client/src. The local override just swaps DevSettings.reload
// for the spy this file needs.
const mockReload = mock(() => {});
mock.module('react-native', () => ({
    ...rnMockStubs(),
    DevSettings: { reload: mockReload },
}));

// Import after mocks are installed.
const { createReloadAction, reloadApp } = await import('../reloadBundle');

describe('reloadBundle', () => {
    let logSpy: ReturnType<typeof mock>;

    beforeEach(() => {
        logSpy = mock(() => {});
        console.log = logSpy;
        mockReload.mockClear();
    });

    // ── createReloadAction ──

    test('createReloadAction returns an action with label "Reload Bundle"', () => {
        const action = createReloadAction();
        expect(action.label).toBe('Reload Bundle');
        expect(typeof action.onPress).toBe('function');
    });

    test('createReloadAction onPress delegates to reloadApp', () => {
        const action = createReloadAction();
        action.onPress();
        expect(mockReload).toHaveBeenCalledTimes(1);
    });

    // ── reloadApp ──

    test('reloadApp calls DevSettings.reload', () => {
        reloadApp();
        expect(mockReload).toHaveBeenCalledTimes(1);
    });

    test('reloadApp does NOT call OnlookRuntime.reloadBundle (bundleSource-less fast-path removed)', () => {
        // Even when OnlookRuntime is installed, the dev-menu reload path
        // MUST NOT invoke the native reloadBundle — that JSI method
        // requires a bundle source this action doesn't have. Regression
        // guard for the fix to the TS2554 type error that the old code
        // produced by calling `reloadBundle()` with zero args.
        const runtimeReload = mock(() => {});
        const prior = (globalThis as Record<string, unknown>).OnlookRuntime;
        (globalThis as Record<string, unknown>).OnlookRuntime = {
            reloadBundle: runtimeReload,
        };
        try {
            reloadApp();
            expect(runtimeReload).toHaveBeenCalledTimes(0);
            expect(mockReload).toHaveBeenCalledTimes(1);
        } finally {
            (globalThis as Record<string, unknown>).OnlookRuntime = prior;
        }
    });

    test('reloadApp logs a reload message (cold-path)', () => {
        reloadApp();
        expect(logSpy).toHaveBeenCalled();
        const loggedMessage = logSpy.mock.calls[0]?.[0] as string;
        expect(loggedMessage).toContain('[onlook-runtime] reload');
        expect(loggedMessage).toContain('DevSettings.reload()');
    });

    // ── ABI v1 fast-path tests — task #27 ──

    test('reloadApp uses mountOverlay fast-path when OnlookRuntime.lastMount is present', () => {
        const mountSpy = mock((_s: string, _p?: unknown, _a?: unknown) => {});
        const prior = (globalThis as Record<string, unknown>).OnlookRuntime;
        (globalThis as Record<string, unknown>).OnlookRuntime = {
            abi: 'v1',
            lastMount: { source: 'cached-source', props: { sessionId: 'x' } },
            mountOverlay: mountSpy,
        };
        try {
            reloadApp();
            expect(mountSpy).toHaveBeenCalledTimes(1);
            const call = mountSpy.mock.calls[0] ?? [];
            expect(call[0]).toBe('cached-source');
            expect(call[1]).toEqual({ sessionId: 'x' });
            expect(mockReload).toHaveBeenCalledTimes(0);
        } finally {
            (globalThis as Record<string, unknown>).OnlookRuntime = prior;
        }
    });

    test('reloadApp falls back to DevSettings.reload if mountOverlay throws', () => {
        const mountSpy = mock(() => {
            throw new Error('mount boom');
        });
        const prior = (globalThis as Record<string, unknown>).OnlookRuntime;
        (globalThis as Record<string, unknown>).OnlookRuntime = {
            abi: 'v1',
            lastMount: { source: 'src', props: {} },
            mountOverlay: mountSpy,
        };
        try {
            reloadApp();
            expect(mountSpy).toHaveBeenCalledTimes(1);
            expect(mockReload).toHaveBeenCalledTimes(1);
        } finally {
            (globalThis as Record<string, unknown>).OnlookRuntime = prior;
        }
    });

    test('reloadApp falls back to DevSettings.reload when OnlookRuntime.abi is not v1', () => {
        const mountSpy = mock(() => {});
        const prior = (globalThis as Record<string, unknown>).OnlookRuntime;
        (globalThis as Record<string, unknown>).OnlookRuntime = {
            abi: 'v0',
            lastMount: { source: 's', props: {} },
            mountOverlay: mountSpy,
        };
        try {
            reloadApp();
            expect(mountSpy).toHaveBeenCalledTimes(0);
            expect(mockReload).toHaveBeenCalledTimes(1);
        } finally {
            (globalThis as Record<string, unknown>).OnlookRuntime = prior;
        }
    });
});

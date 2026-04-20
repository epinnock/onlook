/**
 * Tests for the reload bundle dev menu action.
 *
 * Task: MC5.11
 * Validate: bun test apps/mobile-client/src/actions/__tests__/reloadBundle.test.ts
 */

import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';

// ── Mock react-native DevSettings before importing the module under test ──
const mockReload = mock(() => {});
mock.module('react-native', () => ({
    DevSettings: { reload: mockReload },
    // Stubs required by the DevMenuAction type import chain
    Modal: {},
    Pressable: {},
    SafeAreaView: {},
    ScrollView: {},
    StyleSheet: { create: (s: Record<string, unknown>) => s },
    Text: {},
    View: {},
}));

// Import after mocks are installed.
const { createReloadAction, reloadApp } = await import('../reloadBundle');

describe('reloadBundle', () => {
    let logSpy: ReturnType<typeof mock>;
    let savedOnlookRuntime: unknown;

    beforeEach(() => {
        logSpy = mock(() => {});
        console.log = logSpy;
        savedOnlookRuntime = (globalThis as Record<string, unknown>).OnlookRuntime;
        delete (globalThis as Record<string, unknown>).OnlookRuntime;
        mockReload.mockClear();
    });

    afterEach(() => {
        (globalThis as Record<string, unknown>).OnlookRuntime = savedOnlookRuntime;
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
        // Should have fallen back to DevSettings.reload since OnlookRuntime is absent.
        expect(mockReload).toHaveBeenCalledTimes(1);
    });

    // ── reloadApp with OnlookRuntime available ──

    test('reloadApp calls OnlookRuntime.reloadBundle when available', () => {
        const runtimeReload = mock(() => {});
        (globalThis as Record<string, unknown>).OnlookRuntime = {
            reloadBundle: runtimeReload,
        };

        reloadApp();

        expect(runtimeReload).toHaveBeenCalledTimes(1);
        // DevSettings.reload should NOT be called when OnlookRuntime is present.
        expect(mockReload).toHaveBeenCalledTimes(0);
    });

    // ── reloadApp fallback ──

    test('reloadApp falls back to DevSettings.reload when OnlookRuntime is unavailable', () => {
        // OnlookRuntime was deleted in beforeEach.
        reloadApp();

        expect(mockReload).toHaveBeenCalledTimes(1);
    });

    // ── logging ──

    test('reloadApp logs a reload message', () => {
        reloadApp();

        expect(logSpy).toHaveBeenCalled();
        const loggedMessage = logSpy.mock.calls[0]?.[0] as string;
        expect(loggedMessage).toContain('[onlook-runtime] reload triggered');
    });
});

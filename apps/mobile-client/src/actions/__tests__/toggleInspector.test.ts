/**
 * Tests for the toggle inspector dev menu action.
 *
 * Task: MC5.13
 * Validate: bun test apps/mobile-client/src/actions/__tests__/toggleInspector.test.ts
 */

import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import { rnMockStubs } from '../../__tests__/helpers/rnMock';

// ── Mock react-native via the shared comprehensive stub ──
// See src/__tests__/helpers/rnMock.ts for why comprehensive coverage is
// required (bun's mock.module is process-wide without restore).
mock.module('react-native', () => rnMockStubs());

// Import after mocks are installed.
const {
    inspectorState,
    createToggleInspectorAction,
    onInspectorToggle,
    isInspectorEnabled,
} = await import('../toggleInspector');

describe('toggleInspector', () => {
    let logSpy: ReturnType<typeof mock>;

    beforeEach(() => {
        // Reset state to disabled before each test.
        inspectorState.enabled = false;
        logSpy = mock(() => {});
        console.log = logSpy;
    });

    afterEach(() => {
        // Nothing to restore; inspectorState is reset in beforeEach.
    });

    // ── Initial state ──

    test('initial state is disabled', () => {
        expect(inspectorState.enabled).toBe(false);
        expect(isInspectorEnabled()).toBe(false);
    });

    // ── Toggle flips state ──

    test('toggle flips state from disabled to enabled', () => {
        const action = createToggleInspectorAction();
        action.onPress();
        expect(inspectorState.enabled).toBe(true);
        expect(isInspectorEnabled()).toBe(true);
    });

    // ── Action label ──

    test('action label is "Toggle Inspector"', () => {
        const action = createToggleInspectorAction();
        expect(action.label).toBe('Toggle Inspector');
        expect(typeof action.onPress).toBe('function');
    });

    // ── Listener fires on toggle ──

    test('listener fires with the new state when toggled', () => {
        const handler = mock((_enabled: boolean) => {});
        const unsub = onInspectorToggle(handler);

        const action = createToggleInspectorAction();
        action.onPress(); // disabled -> enabled

        expect(handler).toHaveBeenCalledTimes(1);
        expect(handler.mock.calls[0]![0]).toBe(true);

        unsub();
    });

    // ── Unsubscribe stops delivery ──

    test('unsubscribe stops listener delivery', () => {
        const handler = mock((_enabled: boolean) => {});
        const unsub = onInspectorToggle(handler);

        unsub(); // Unsubscribe immediately.

        const action = createToggleInspectorAction();
        action.onPress();

        expect(handler).toHaveBeenCalledTimes(0);
    });

    // ── Double toggle returns to original state ──

    test('double toggle returns to the original disabled state', () => {
        const action = createToggleInspectorAction();
        action.onPress(); // disabled -> enabled
        expect(inspectorState.enabled).toBe(true);

        action.onPress(); // enabled -> disabled
        expect(inspectorState.enabled).toBe(false);
        expect(isInspectorEnabled()).toBe(false);
    });

    // ── Logging ──

    test('toggle logs the correct state message', () => {
        const action = createToggleInspectorAction();

        action.onPress(); // disabled -> enabled
        expect(logSpy).toHaveBeenCalled();
        const firstMsg = logSpy.mock.calls[0]?.[0] as string;
        expect(firstMsg).toContain('[onlook-runtime] inspector enabled');

        action.onPress(); // enabled -> disabled
        const secondMsg = logSpy.mock.calls[1]?.[0] as string;
        expect(secondMsg).toContain('[onlook-runtime] inspector disabled');
    });
});

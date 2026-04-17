/**
 * Tests for the copy-session-id dev menu action (MC5.14).
 *
 * `react-native` is mocked so the test can:
 *   - Observe Clipboard.setString calls.
 *   - Observe Alert.alert calls.
 *   - Avoid loading the real native module (unavailable in `bun test`).
 *
 * Task: MC5.14
 */

import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';

// ── Mock react-native BEFORE dynamic import ──
const clipboardCalls: string[] = [];
const alertCalls: Array<{ title: string; message?: string }> = [];

mock.module('react-native', () => ({
    Alert: {
        alert: (title: string, message?: string) => {
            alertCalls.push({ title, message });
        },
    },
    Clipboard: {
        setString: (value: string) => {
            clipboardCalls.push(value);
        },
    },
    // Shims used by the DevMenuAction type's import graph.
    Modal: {},
    Pressable: {},
    SafeAreaView: {},
    ScrollView: {},
    StyleSheet: { create: (s: Record<string, unknown>) => s },
    Text: {},
    View: {},
}));

// Dynamic import so the mock takes effect.
const { createCopySessionIdAction, copySessionIdToClipboard } = await import(
    '../copySessionId'
);

// Capture console.log calls for assertion.
const logCalls: string[] = [];
const originalLog = console.log;

beforeEach(() => {
    clipboardCalls.length = 0;
    alertCalls.length = 0;
    logCalls.length = 0;
    console.log = (...args: unknown[]) => {
        logCalls.push(args.map(String).join(' '));
    };
});

afterEach(() => {
    console.log = originalLog;
});

describe('copySessionId (MC5.14)', () => {
    test('action has correct label and onPress is a function', () => {
        const action = createCopySessionIdAction(() => 'sess-xyz');

        expect(action.label).toBe('Copy Session ID');
        expect(typeof action.onPress).toBe('function');
        expect(action.destructive).toBeUndefined();
    });

    test('copies the session ID to the clipboard when present', () => {
        const action = createCopySessionIdAction(() => 'sess-abc-123');

        action.onPress();

        expect(clipboardCalls).toEqual(['sess-abc-123']);
        expect(alertCalls).toHaveLength(1);
        expect(alertCalls[0]!.title).toBe('Session ID copied');
    });

    test('shows "No active session" alert when getter returns null', () => {
        const action = createCopySessionIdAction(() => null);

        action.onPress();

        expect(clipboardCalls).toHaveLength(0);
        expect(alertCalls).toHaveLength(1);
        expect(alertCalls[0]!.title).toBe('No active session');
    });

    test('logs the copied session ID with the runtime prefix', () => {
        const action = createCopySessionIdAction(() => 'sess-logged-42');

        action.onPress();

        const loggedCopy = logCalls.find((m) =>
            m.includes('[onlook-runtime] session ID copied: sess-logged-42'),
        );
        expect(loggedCopy).toBeDefined();
    });

    test('does not log or alert "copied" when session is absent', () => {
        const action = createCopySessionIdAction(() => null);

        action.onPress();

        expect(
            logCalls.some((m) => m.includes('session ID copied')),
        ).toBe(false);
        expect(
            alertCalls.some((a) => a.title === 'Session ID copied'),
        ).toBe(false);
    });

    test('copySessionIdToClipboard standalone helper writes to clipboard and logs', () => {
        copySessionIdToClipboard('sess-standalone');

        expect(clipboardCalls).toEqual(['sess-standalone']);
        expect(
            logCalls.some((m) =>
                m.includes('[onlook-runtime] session ID copied: sess-standalone'),
            ),
        ).toBe(true);
    });

    test('re-invoking the action reads the latest value from the getter', () => {
        let current: string | null = 'sess-1';
        const action = createCopySessionIdAction(() => current);

        action.onPress();
        current = 'sess-2';
        action.onPress();
        current = null;
        action.onPress();

        expect(clipboardCalls).toEqual(['sess-1', 'sess-2']);
        expect(alertCalls.map((a) => a.title)).toEqual([
            'Session ID copied',
            'Session ID copied',
            'No active session',
        ]);
    });
});

/**
 * Dev menu action: copy session ID — MC5.14
 *
 * Copies the currently active session ID to the system clipboard via
 * React Native's `Clipboard` module. Falls back to a console log when the
 * clipboard API is unavailable (e.g., running in a test harness).
 */

import { Alert, Clipboard } from 'react-native';
import type { DevMenuAction } from '../components/DevMenu';

const LOG_PREFIX = '[onlook-runtime]';

/** Getter that yields the current session ID, or null when disconnected. */
export type SessionIdGetter = () => string | null;

/**
 * Copy the supplied session ID to the clipboard.
 *
 * Resolution order:
 *  1. `Clipboard.setString` from `react-native` (primary path).
 *  2. Falls back to logging the ID when clipboard is unavailable.
 */
export function copySessionIdToClipboard(sessionId: string): void {
    const clipboard = Clipboard as { setString?: (value: string) => void } | undefined;

    if (clipboard && typeof clipboard.setString === 'function') {
        clipboard.setString(sessionId);
    } else {
        console.log(`${LOG_PREFIX} clipboard unavailable, session ID: ${sessionId}`);
    }

    console.log(`${LOG_PREFIX} session ID copied: ${sessionId}`);
}

/**
 * Create a `DevMenuAction` that copies the current session ID to the
 * clipboard. When there is no active session, surfaces an alert instead.
 */
export function createCopySessionIdAction(
    getSessionId: SessionIdGetter,
): DevMenuAction {
    return {
        label: 'Copy Session ID',
        onPress: () => {
            const sessionId = getSessionId();

            if (sessionId == null) {
                Alert.alert('No active session');
                return;
            }

            copySessionIdToClipboard(sessionId);
            Alert.alert('Session ID copied');
        },
    };
}

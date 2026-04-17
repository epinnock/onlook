/**
 * Dev menu action: reload bundle — MC5.11
 *
 * Exposes a reload action for the dev menu and a standalone `reloadApp`
 * function for programmatic use.
 *
 * Strategy:
 *  1. If `globalThis.OnlookRuntime.reloadBundle` is available (MC2.8),
 *     invoke it for a seamless JSI-level reload.
 *  2. Otherwise fall back to React Native's `DevSettings.reload()`,
 *     which is available in debug builds.
 */

import type { DevMenuAction } from '../components/DevMenu';
import { DevSettings } from 'react-native';

/* ── globalThis type augmentation for the OnlookRuntime JSI binding ── */
declare global {
    // eslint-disable-next-line no-var
    var OnlookRuntime: { reloadBundle?: () => void } | undefined;
}

const LOG_PREFIX = '[onlook-runtime]';

/**
 * Reload the running JS bundle.
 *
 * Tries the OnlookRuntime JSI binding first, then falls back to RN
 * DevSettings. Safe to call at any time.
 */
export function reloadApp(): void {
    console.log(`${LOG_PREFIX} reload triggered`);

    if (typeof globalThis.OnlookRuntime?.reloadBundle === 'function') {
        globalThis.OnlookRuntime.reloadBundle();
        return;
    }

    // Fallback: standard React Native dev reload.
    DevSettings.reload();
}

/**
 * Create a `DevMenuAction` that reloads the JS bundle when pressed.
 */
export function createReloadAction(): DevMenuAction {
    return {
        label: 'Reload Bundle',
        onPress: reloadApp,
    };
}

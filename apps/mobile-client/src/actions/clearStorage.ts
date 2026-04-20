/**
 * Dev menu action: clear storage — MC5.12
 *
 * Wipes all app-persisted data from `expo-secure-store` and the recent
 * sessions list (MC3.8). Designed for use as a DevMenu action and as a
 * standalone function for programmatic use.
 *
 * Cleared keys:
 *  - Recent sessions (via `clearRecentSessions`)
 *  - `onlook_relay_host_override`  (MC3.10 SettingsScreen)
 *  - `onlook_dev_menu_enabled`     (MC3.10 SettingsScreen)
 */

import * as SecureStore from 'expo-secure-store';
import type { DevMenuAction } from '../components/DevMenu';
import { clearRecentSessions } from '../storage';

const LOG_PREFIX = '[onlook-runtime]';

/** Secure-store keys managed by SettingsScreen (MC3.10). */
const SETTINGS_KEYS = [
    'onlook_relay_host_override',
    'onlook_dev_menu_enabled',
] as const;

/**
 * Clear all Onlook-managed storage: recent sessions and settings keys.
 *
 * Safe to call at any time — individual deletions that fail (e.g. key
 * already absent) are swallowed by `expo-secure-store`.
 */
export async function clearAllStorage(): Promise<void> {
    await clearRecentSessions();
    await Promise.all(
        SETTINGS_KEYS.map((key) => SecureStore.deleteItemAsync(key)),
    );
    console.log(`${LOG_PREFIX} storage cleared`);
}

/**
 * Create a `DevMenuAction` that clears all persisted storage when pressed.
 */
export function createClearStorageAction(): DevMenuAction {
    return {
        label: 'Clear Storage',
        onPress: async () => {
            await clearAllStorage();
        },
        destructive: true,
    };
}

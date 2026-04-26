/**
 * Dev menu enabled state — in-memory observable + SecureStore persistence
 * for the `onlook_dev_menu_enabled` key.
 *
 * Both `SettingsScreen` (the toggle UI) and `App.tsx` (the
 * `<DevMenuTrigger disabled={!enabled} />` consumer) read the same
 * state through this module so a toggle in settings takes effect
 * immediately without requiring an app restart. Default is OFF —
 * matching the existing SettingsScreen behavior on a first launch
 * before the user has opted in.
 *
 * Pattern mirrors `actions/toggleInspector.ts`: a small observable
 * with a Set-based listener registry. Persistence is added on top:
 * `loadDevMenuEnabled()` syncs from disk at app boot;
 * `setDevMenuEnabled()` writes to disk before notifying listeners.
 */
import * as SecureStore from 'expo-secure-store';

/** SecureStore key — must match the one used by `SettingsScreen.tsx`. */
export const DEV_MENU_ENABLED_KEY = 'onlook_dev_menu_enabled';

type Listener = (enabled: boolean) => void;

let enabled = false;
const listeners = new Set<Listener>();

function notify(): void {
    for (const handler of listeners) {
        handler(enabled);
    }
}

/**
 * Read the persisted value from SecureStore and update in-memory state.
 * Notifies listeners if the value changed. Safe to call multiple times.
 * Defaults to `false` when the key is absent or any parse error occurs —
 * matching the SettingsScreen UX where dev mode is opt-in.
 */
export async function loadDevMenuEnabled(): Promise<boolean> {
    let next = false;
    try {
        const raw = await SecureStore.getItemAsync(DEV_MENU_ENABLED_KEY);
        if (raw !== null) {
            next = raw === 'true';
        }
    } catch {
        // SecureStore unavailable (bare JS / test harness) → keep default.
        next = false;
    }
    if (next !== enabled) {
        enabled = next;
        notify();
    }
    return enabled;
}

/**
 * Persist + propagate a new value. Updates in-memory state, fires
 * listeners, then writes to SecureStore. If the SecureStore write
 * throws (very unusual), the in-memory state still reflects the user's
 * intent for the current session.
 */
export async function setDevMenuEnabled(value: boolean): Promise<void> {
    if (enabled !== value) {
        enabled = value;
        notify();
    }
    try {
        await SecureStore.setItemAsync(DEV_MENU_ENABLED_KEY, String(value));
    } catch {
        // Persistence failure is non-fatal — the next launch will read
        // the previous value, but the current session reflects the
        // user's toggle.
    }
}

/** Synchronous getter — returns the current in-memory state. */
export function isDevMenuEnabled(): boolean {
    return enabled;
}

/**
 * Subscribe to changes. The handler fires with the new value AFTER
 * `setDevMenuEnabled` or `loadDevMenuEnabled` has updated state. Returns
 * an unsubscribe function. The handler is NOT called with the current
 * value on subscription — read `isDevMenuEnabled()` synchronously if the
 * caller needs the initial value.
 */
export function onDevMenuEnabledChange(handler: Listener): () => void {
    listeners.add(handler);
    return () => {
        listeners.delete(handler);
    };
}

/**
 * Test-only helper. Resets in-memory state to the default and clears
 * all listeners so each test starts clean. Calling this in production
 * is a bug.
 */
export function __resetDevMenuEnabledForTests(): void {
    enabled = false;
    listeners.clear();
}

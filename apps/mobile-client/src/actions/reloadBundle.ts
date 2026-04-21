/**
 * Dev menu action: reload bundle — MC5.11
 *
 * Exposes a reload action for the dev menu and a standalone `reloadApp`
 * function for programmatic use.
 *
 * Implementation note: an earlier version tried to call
 * `globalThis.OnlookRuntime.reloadBundle()` as a fast-path, but the
 * native JSI method requires a `bundleSource: string` argument (see
 * `cpp/OnlookRuntime_reloadBundle.cpp` and the canonical global type
 * declared in `src/flow/twoTierBootstrap.ts`). This dev action doesn't
 * know *which* bundle to reload TO — its job is "reset the whole JS
 * runtime and re-bootstrap from launcher" — so the correct call is
 * React Native's `DevSettings.reload()`, which tears down and restarts
 * the entire JS context. The native `reloadBundle` is reserved for the
 * hot-reload path that already has a fresh bundle in hand (two-tier
 * overlay channel; see `flow/twoTierBootstrap.ts`).
 */

import type { DevMenuAction } from '../components/DevMenu';
import { DevSettings } from 'react-native';

const LOG_PREFIX = '[onlook-runtime]';

/**
 * Reload the running JS bundle via React Native's DevSettings, which
 * tears down the JS context and restarts from the launcher. Safe to
 * call at any time in debug builds. No-op in release builds where
 * DevSettings is a stub.
 */
export function reloadApp(): void {
    console.log(`${LOG_PREFIX} reload triggered`);
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

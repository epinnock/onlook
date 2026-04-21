/**
 * Dev menu action: reload bundle — MC5.11, updated for ABI v1 task #27.
 *
 * Two-path reload:
 *
 *   1. **ABI v1 hot reload (preferred)** — if `globalThis.OnlookRuntime.lastMount.source`
 *      is cached, call `OnlookRuntime.mountOverlay(lastMount.source, lastMount.props,
 *      lastMount.assets)` to re-mount WITHOUT tearing down the JS context. Preserves
 *      session state, logs, relay connection. This is the hot-iteration story the
 *      two-tier overlay plan promises.
 *   2. **Cold restart fallback** — if no `lastMount` snapshot exists (first boot, or
 *      the JS runtime hasn't yet loaded a v1 overlay), fall back to
 *      `DevSettings.reload()`, which tears down the whole JS context and re-bootstraps
 *      from the launcher. Always safe, just much slower.
 *
 * See `plans/adr/overlay-abi-v1.md` §"Runtime globals" — `lastMount` is a contractual
 * field of the OnlookRuntime API, populated by `mountOverlay` on every successful mount.
 */

import type { DevMenuAction } from '../components/DevMenu';
import { DevSettings } from 'react-native';

const LOG_PREFIX = '[onlook-runtime]';

interface OnlookRuntimeMinimal {
    readonly abi?: string;
    readonly lastMount?: {
        readonly source: string;
        readonly props?: Readonly<Record<string, unknown>>;
        readonly assets?: unknown;
    };
    mountOverlay?: (
        source: string,
        props?: Readonly<Record<string, unknown>>,
        assets?: unknown,
    ) => void;
}

/**
 * Reload the current overlay via `OnlookRuntime.mountOverlay(lastMount.source, ...)`
 * when possible, otherwise fall back to `DevSettings.reload()`. The fast path is safe
 * — it always re-mounts from the exact source the runtime most recently executed, so
 * the resulting JS state matches post-mount semantics (same as if the edit had just
 * landed fresh from the editor).
 *
 * No-op-on-failure: any error from `mountOverlay` falls through to `DevSettings.reload()`
 * so the user never sees a stuck dev menu.
 */
export function reloadApp(): void {
    const rt = (globalThis as unknown as { OnlookRuntime?: OnlookRuntimeMinimal })
        .OnlookRuntime;
    const snapshot = rt?.lastMount;
    if (rt?.abi === 'v1' && snapshot && typeof rt.mountOverlay === 'function') {
        console.log(`${LOG_PREFIX} reload via OnlookRuntime.mountOverlay (fast path)`);
        try {
            rt.mountOverlay(snapshot.source, snapshot.props, snapshot.assets);
            return;
        } catch (err) {
            console.warn(
                `${LOG_PREFIX} mountOverlay fast-path failed, falling back to DevSettings.reload()`,
                err,
            );
        }
    }
    console.log(`${LOG_PREFIX} reload via DevSettings.reload() (cold restart)`);
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

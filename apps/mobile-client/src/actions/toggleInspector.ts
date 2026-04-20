/**
 * Dev menu action: toggle inspector overlay — MC5.13
 *
 * Provides a simple observable for inspector state with a lightweight
 * listener pattern (no MobX dependency). The inspector overlay can be
 * toggled via the dev menu or programmatically.
 */

import type { DevMenuAction } from '../components/DevMenu';

const LOG_PREFIX = '[onlook-runtime]';

/* ── Observable state ── */

type Listener = (enabled: boolean) => void;

const listeners = new Set<Listener>();

/** Observable inspector state. */
export const inspectorState: { enabled: boolean } = { enabled: false };

/* ── Listener registration ── */

/**
 * Register a handler that is called whenever the inspector state changes.
 * Returns an unsubscribe function.
 */
export function onInspectorToggle(handler: Listener): () => void {
    listeners.add(handler);
    return () => {
        listeners.delete(handler);
    };
}

/* ── Getter ── */

/** Returns the current inspector enabled state. */
export function isInspectorEnabled(): boolean {
    return inspectorState.enabled;
}

/* ── Toggle logic ── */

function toggle(): void {
    inspectorState.enabled = !inspectorState.enabled;
    const { enabled } = inspectorState;
    console.log(`${LOG_PREFIX} inspector ${enabled ? 'enabled' : 'disabled'}`);

    for (const handler of listeners) {
        handler(enabled);
    }
}

/* ── DevMenuAction factory ── */

/**
 * Create a `DevMenuAction` that toggles the inspector overlay.
 */
export function createToggleInspectorAction(): DevMenuAction {
    return {
        label: 'Toggle Inspector',
        onPress: toggle,
    };
}

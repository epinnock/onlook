/**
 * Overlay pipeline status machine — task #80 / two-tier-overlay-v2 Phase 9.
 *
 * Models the editor-visible status of a single overlay push: idle → building →
 * uploading-assets → sent → (mounted | error). Consumers drive a small state
 * store (MobX, Zustand, etc.) off this enum so the preview surface can render
 * progress spinners, error toasts, and "mounted" confirmations without
 * re-implementing transition rules per call site.
 */
import type { OnlookRuntimeError } from '@onlook/mobile-client-protocol';

export type OverlayStatusState =
    | 'idle'
    | 'building'
    | 'uploading-assets'
    | 'sent'
    | 'mounted'
    | 'error';

export interface OverlayStatusSnapshot {
    readonly state: OverlayStatusState;
    /** Opaque stable id so downstream consumers can diff. */
    readonly revision: number;
    /** Error details, populated only when state === 'error'. */
    readonly error?: OnlookRuntimeError;
    /** Non-null hash of the overlay currently being reported on. */
    readonly overlayHash?: string;
}

/** Allowed transitions — keys are "from" states, values are allowed "to" states. */
const ALLOWED_TRANSITIONS: Record<OverlayStatusState, readonly OverlayStatusState[]> = {
    idle: ['building', 'error'],
    building: ['uploading-assets', 'sent', 'error'],
    'uploading-assets': ['sent', 'error'],
    sent: ['mounted', 'error', 'building'],
    mounted: ['building', 'error'],
    error: ['building', 'idle'],
};

export class OverlayStatusMachine {
    private snapshot: OverlayStatusSnapshot;
    private readonly listeners = new Set<(s: OverlayStatusSnapshot) => void>();
    private revision = 0;

    constructor(initial: OverlayStatusState = 'idle') {
        this.snapshot = { state: initial, revision: 0 };
    }

    get(): OverlayStatusSnapshot {
        return this.snapshot;
    }

    subscribe(listener: (s: OverlayStatusSnapshot) => void): () => void {
        this.listeners.add(listener);
        listener(this.snapshot);
        return () => {
            this.listeners.delete(listener);
        };
    }

    /**
     * Transition to a new state. Throws `OverlayStatusTransitionError` on an
     * illegal transition — callers are expected to either match the machine or
     * catch + call `reset()` to get back to a known state.
     */
    transition(
        next: OverlayStatusState,
        extras: { error?: OnlookRuntimeError; overlayHash?: string } = {},
    ): OverlayStatusSnapshot {
        const from = this.snapshot.state;
        if (!ALLOWED_TRANSITIONS[from].includes(next)) {
            throw new OverlayStatusTransitionError(from, next);
        }
        if (next === 'error' && !extras.error) {
            throw new Error(
                'OverlayStatusMachine: transition to "error" requires an OnlookRuntimeError',
            );
        }
        this.revision += 1;
        this.snapshot = {
            state: next,
            revision: this.revision,
            ...(extras.error !== undefined ? { error: extras.error } : {}),
            ...(extras.overlayHash !== undefined ? { overlayHash: extras.overlayHash } : {}),
        };
        for (const l of this.listeners) l(this.snapshot);
        return this.snapshot;
    }

    reset(): OverlayStatusSnapshot {
        this.revision += 1;
        this.snapshot = { state: 'idle', revision: this.revision };
        for (const l of this.listeners) l(this.snapshot);
        return this.snapshot;
    }
}

export class OverlayStatusTransitionError extends Error {
    constructor(
        public readonly from: OverlayStatusState,
        public readonly to: OverlayStatusState,
    ) {
        super(`Invalid overlay status transition: ${from} → ${to}`);
        this.name = 'OverlayStatusTransitionError';
    }
}

/**
 * Pure transition check — useful for UI code that wants to show or hide
 * actions without catching exceptions.
 */
export function canTransition(
    from: OverlayStatusState,
    to: OverlayStatusState,
): boolean {
    return ALLOWED_TRANSITIONS[from].includes(to);
}

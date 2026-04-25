/**
 * Overlay pipeline composer — task #79 refinement.
 *
 * Chains the debouncer → pushOverlayV1 → status machine into a single helper
 * so feature callers don't wire these together per call site.
 *
 *   pipeline.schedule({code, buildDurationMs, assets?, sourceMap?})
 *       → debouncer fires (150ms) → status:'building' →
 *       pushOverlayV1 → status:'sent' (or 'error')
 *
 * The caller subscribes to pipeline.status for UI updates and calls
 * pipeline.markMounted(overlayHash) when the phone reports the overlay is
 * live (from the `onlook:error` absence heuristic or an explicit
 * acknowledgement message — up to the integration layer).
 */
import { createOverlayDebouncer, type Debouncer } from './overlay-debounce';
import {
    OverlayStatusMachine,
    type OverlayStatusSnapshot,
} from './overlay-status';
import {
    pushOverlayV1,
    type OverlaySourceV1,
    type PushOverlayResult,
    type PushOverlayV1Options,
} from './push-overlay';
import type { OverlayAssetManifest } from '@onlook/mobile-client-protocol';

export interface OverlayPipelineOptions {
    readonly relayBaseUrl: string;
    readonly sessionId: string;
    readonly delayMs?: number;
    readonly push?: typeof pushOverlayV1;
    readonly clock?: Parameters<typeof createOverlayDebouncer>[0]['clock'];
}

export interface PipelineInput {
    readonly overlay: OverlaySourceV1;
    readonly assets?: OverlayAssetManifest;
}

export interface OverlayPipeline {
    readonly status: OverlayStatusMachine;
    /** Schedule an overlay for debounced push. Earlier pending schedules are dropped. */
    schedule(input: PipelineInput): void;
    /** Cancel any pending debounce; status returns to idle if a build was waiting. */
    cancel(): void;
    /** Mark the most-recent successful push as mounted. */
    markMounted(overlayHash: string): void;
    /** Wait for any pending debounce + push to settle — useful in tests. */
    drain(): Promise<void>;
}

export function createOverlayPipeline(options: OverlayPipelineOptions): OverlayPipeline {
    const pushImpl = options.push ?? pushOverlayV1;
    const status = new OverlayStatusMachine();
    let lastOverlayHash: string | null = null;

    const debouncer: Debouncer<PipelineInput> = createOverlayDebouncer<PipelineInput>({
        delayMs: options.delayMs ?? 150,
        clock: options.clock,
        invoke: async (input) => {
            if (status.get().state !== 'building') {
                try {
                    status.transition('building');
                } catch {
                    status.reset();
                    status.transition('building');
                }
            }
            try {
                const pushOpts: PushOverlayV1Options = {
                    relayBaseUrl: options.relayBaseUrl,
                    sessionId: options.sessionId,
                    overlay: input.overlay,
                    ...(input.assets ? { assets: input.assets } : {}),
                    onTelemetry: null,
                };
                const result: PushOverlayResult = await pushImpl(pushOpts);
                if (result.ok) {
                    status.transition('sent');
                } else {
                    status.transition('error', {
                        error: {
                            kind: 'overlay-runtime',
                            message: `pushOverlayV1 failed: ${result.error}`,
                        },
                    });
                }
            } catch (err) {
                status.transition('error', {
                    error: {
                        kind: 'overlay-runtime',
                        message:
                            err instanceof Error ? err.message : 'unknown pipeline error',
                    },
                });
            }
        },
    });

    return {
        status,
        schedule(input) {
            debouncer.schedule(input);
        },
        cancel() {
            debouncer.cancel();
        },
        markMounted(overlayHash) {
            lastOverlayHash = overlayHash;
            if (status.get().state === 'sent' || status.get().state === 'mounted') {
                try {
                    status.transition('mounted', { overlayHash });
                } catch {
                    // If we're not in 'sent' or 'mounted' the transition is illegal —
                    // the caller is trying to mark a stale hash as mounted.
                }
            }
            void lastOverlayHash; // retained for future diffing use
        },
        drain() {
            return debouncer.drain();
        },
    };
}

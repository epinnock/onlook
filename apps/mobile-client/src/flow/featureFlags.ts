/**
 * Feature flags for the Onlook mobile client.
 *
 * The two-tier pipeline flag mirrors the editor's
 * `NEXT_PUBLIC_MOBILE_PREVIEW_PIPELINE`. In the client it's sourced from
 * `process.env.EXPO_PUBLIC_MOBILE_PREVIEW_PIPELINE` so the flag can be
 * toggled at build time via `expo start --env-file` / EAS build env without
 * code changes. Unknown values collapse to `shim` to keep the legacy path
 * as the safe default.
 *
 * Pipeline values (task #92 — kill switch):
 * - `shim`       — legacy single-bundle relay path (default).
 * - `two-tier`   — legacy overlay wire (`OverlayMessage`, `wrapOverlayCode`).
 * - `overlay-v1` — ABI v1 (`OverlayUpdateMessage`, `wrapOverlayV1`,
 *                  `OnlookRuntime.mountOverlay`). See
 *                  `plans/adr/overlay-abi-v1.md`.
 */
export type MobilePreviewPipeline = 'shim' | 'two-tier' | 'overlay-v1';

const VALID_PIPELINES: readonly MobilePreviewPipeline[] = [
    'shim',
    'two-tier',
    'overlay-v1',
];

function normalizePipeline(value: string | undefined): MobilePreviewPipeline {
    if (value && (VALID_PIPELINES as readonly string[]).includes(value)) {
        return value as MobilePreviewPipeline;
    }
    return 'shim';
}

export function getMobilePreviewPipeline(): MobilePreviewPipeline {
    const raw: unknown = process.env.EXPO_PUBLIC_MOBILE_PREVIEW_PIPELINE;
    return normalizePipeline(typeof raw === 'string' ? raw : undefined);
}

/** Legacy pre-ABI two-tier path. */
export function isTwoTierPipelineEnabled(): boolean {
    return getMobilePreviewPipeline() === 'two-tier';
}

/** ABI v1 path. Disjoint from `two-tier`. */
export function isOverlayV1Enabled(): boolean {
    return getMobilePreviewPipeline() === 'overlay-v1';
}

/** True iff the client should connect to an overlay route (legacy or v1). */
export function isAnyOverlayPipelineEnabled(): boolean {
    const p = getMobilePreviewPipeline();
    return p === 'two-tier' || p === 'overlay-v1';
}

/** Test hook — returns the same classification function for direct inputs. */
export function classifyPipelineValue(value: string | undefined): MobilePreviewPipeline {
    return normalizePipeline(value);
}

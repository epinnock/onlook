/**
 * Two-tier preview pipeline feature flag (editor side).
 *
 * Source of truth: `NEXT_PUBLIC_MOBILE_PREVIEW_PIPELINE` in env.ts.
 * - `shim`       → legacy single-bundle relay path (default).
 * - `two-tier`   → base bundle + overlay push via cf-expo-relay `/push` + `/hmr`
 *                  (pre-ABI-v1 wire shape — legacy OverlayMessage).
 * - `overlay-v1` → ABI v1 — `pushOverlayV1` + `wrapOverlayV1` + `OnlookRuntime.mountOverlay`.
 *                  See `plans/adr/overlay-abi-v1.md`.
 *
 * Consumers should call the capability helpers (`isOverlayV1Enabled`,
 * `isTwoTierPipelineEnabled`) rather than reading the env directly so the
 * gates stay centralized and unit-testable.
 */
import { env } from '@/env';

export type MobilePreviewPipeline = 'shim' | 'two-tier' | 'overlay-v1';

export function getMobilePreviewPipeline(): MobilePreviewPipeline {
    return env.NEXT_PUBLIC_MOBILE_PREVIEW_PIPELINE;
}

/** Legacy pre-ABI two-tier path (shipping product path today). */
export function isTwoTierPipelineEnabled(): boolean {
    return getMobilePreviewPipeline() === 'two-tier';
}

/** ABI v1 overlay path. Disjoint from `two-tier` — exactly one may be active. */
export function isOverlayV1Enabled(): boolean {
    return getMobilePreviewPipeline() === 'overlay-v1';
}

/** True iff the editor should push overlays through either two-tier route (legacy or v1). */
export function isAnyOverlayPipelineEnabled(): boolean {
    const p = getMobilePreviewPipeline();
    return p === 'two-tier' || p === 'overlay-v1';
}

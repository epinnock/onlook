/**
 * Two-tier preview pipeline feature flag (editor side).
 *
 * Source of truth: `NEXT_PUBLIC_MOBILE_PREVIEW_PIPELINE` in env.ts.
 * - `shim`     → legacy single-bundle relay path (default).
 * - `two-tier` → base bundle + overlay push via cf-expo-relay /push + /hmr.
 *
 * Consumers should call `isTwoTierPipelineEnabled()` rather than reading
 * the env directly so the gate stays centralized and unit-testable.
 */
import { env } from '@/env';

export type MobilePreviewPipeline = 'shim' | 'two-tier';

export function getMobilePreviewPipeline(): MobilePreviewPipeline {
    return env.NEXT_PUBLIC_MOBILE_PREVIEW_PIPELINE;
}

export function isTwoTierPipelineEnabled(): boolean {
    return getMobilePreviewPipeline() === 'two-tier';
}

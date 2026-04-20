/**
 * Feature flags for the Onlook mobile client.
 *
 * The two-tier pipeline flag mirrors the editor's
 * `NEXT_PUBLIC_MOBILE_PREVIEW_PIPELINE`. In the client it's sourced from
 * `process.env.EXPO_PUBLIC_MOBILE_PREVIEW_PIPELINE` so the flag can be
 * toggled at build time via `expo start --env-file` / EAS build env without
 * code changes. Unknown values collapse to `shim` to keep the legacy path
 * as the safe default.
 */
export type MobilePreviewPipeline = 'shim' | 'two-tier';

const VALID_PIPELINES: readonly MobilePreviewPipeline[] = ['shim', 'two-tier'];

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

export function isTwoTierPipelineEnabled(): boolean {
    return getMobilePreviewPipeline() === 'two-tier';
}

/** Test hook — returns the same classification function for direct inputs. */
export function classifyPipelineValue(value: string | undefined): MobilePreviewPipeline {
    return normalizePipeline(value);
}

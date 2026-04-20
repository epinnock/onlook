import { env } from '@/env';

import type { MobilePreviewPipelineKind } from './pipelines/types';

export const DEFAULT_MOBILE_PREVIEW_PIPELINE: MobilePreviewPipelineKind = 'shim';

export function resolveMobilePreviewPipelineKind(
    value: unknown = env.NEXT_PUBLIC_MOBILE_PREVIEW_PIPELINE,
): MobilePreviewPipelineKind {
    return value === 'two-tier' ? 'two-tier' : DEFAULT_MOBILE_PREVIEW_PIPELINE;
}

export function getMobilePreviewPipelineKind(): MobilePreviewPipelineKind {
    return resolveMobilePreviewPipelineKind();
}

export function isMobilePreviewTwoTierPipelineEnabled(): boolean {
    return getMobilePreviewPipelineKind() === 'two-tier';
}

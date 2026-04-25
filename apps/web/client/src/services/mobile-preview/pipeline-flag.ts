import { env } from '@/env';

import type { MobilePreviewPipelineKind } from './pipelines/types';

export const DEFAULT_MOBILE_PREVIEW_PIPELINE: MobilePreviewPipelineKind = 'shim';

const VALID_KINDS: ReadonlySet<MobilePreviewPipelineKind> = new Set<MobilePreviewPipelineKind>([
    'shim',
    'two-tier',
    'overlay-v1',
]);

export function resolveMobilePreviewPipelineKind(
    value: unknown = env.NEXT_PUBLIC_MOBILE_PREVIEW_PIPELINE,
): MobilePreviewPipelineKind {
    if (typeof value === 'string' && (VALID_KINDS as ReadonlySet<string>).has(value)) {
        return value as MobilePreviewPipelineKind;
    }
    return DEFAULT_MOBILE_PREVIEW_PIPELINE;
}

export function getMobilePreviewPipelineKind(): MobilePreviewPipelineKind {
    return resolveMobilePreviewPipelineKind();
}

export function isMobilePreviewTwoTierPipelineEnabled(): boolean {
    return getMobilePreviewPipelineKind() === 'two-tier';
}

/** ABI v1 pipeline (task #92 kill-switch value `overlay-v1`). */
export function isMobilePreviewOverlayV1PipelineEnabled(): boolean {
    return getMobilePreviewPipelineKind() === 'overlay-v1';
}

/** True iff either overlay-dispatching pipeline (legacy two-tier OR v1) is active. */
export function isAnyMobilePreviewOverlayPipelineEnabled(): boolean {
    const kind = getMobilePreviewPipelineKind();
    return kind === 'two-tier' || kind === 'overlay-v1';
}

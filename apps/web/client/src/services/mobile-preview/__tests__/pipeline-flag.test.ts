import { beforeEach, describe, expect, mock, test } from 'bun:test';

import type { MobilePreviewPipelineKind } from '../pipelines/types';

const mockEnv: {
    NEXT_PUBLIC_MOBILE_PREVIEW_PIPELINE?: MobilePreviewPipelineKind | 'invalid';
} = {};

mock.module('@/env', () => ({
    env: mockEnv,
}));

const {
    DEFAULT_MOBILE_PREVIEW_PIPELINE,
    getMobilePreviewPipelineKind,
    isAnyMobilePreviewOverlayPipelineEnabled,
    isMobilePreviewOverlayV1PipelineEnabled,
    isMobilePreviewTwoTierPipelineEnabled,
    resolveMobilePreviewPipelineKind,
} = await import('../pipeline-flag');

describe('mobile preview pipeline flag', () => {
    beforeEach(() => {
        mockEnv.NEXT_PUBLIC_MOBILE_PREVIEW_PIPELINE = undefined;
    });

    test('defaults to the shim pipeline when the env flag is unset', () => {
        expect(DEFAULT_MOBILE_PREVIEW_PIPELINE).toBe('shim');
        expect(getMobilePreviewPipelineKind()).toBe('shim');
        expect(isMobilePreviewTwoTierPipelineEnabled()).toBe(false);
    });

    test('selects the two-tier pipeline from NEXT_PUBLIC_MOBILE_PREVIEW_PIPELINE', () => {
        mockEnv.NEXT_PUBLIC_MOBILE_PREVIEW_PIPELINE = 'two-tier';

        expect(getMobilePreviewPipelineKind()).toBe('two-tier');
        expect(isMobilePreviewTwoTierPipelineEnabled()).toBe(true);
    });

    test('selects the shim pipeline from NEXT_PUBLIC_MOBILE_PREVIEW_PIPELINE', () => {
        mockEnv.NEXT_PUBLIC_MOBILE_PREVIEW_PIPELINE = 'shim';

        expect(getMobilePreviewPipelineKind()).toBe('shim');
        expect(isMobilePreviewTwoTierPipelineEnabled()).toBe(false);
    });

    test('normalizes unexpected values to the default pipeline', () => {
        expect(resolveMobilePreviewPipelineKind('invalid')).toBe('shim');
        expect(resolveMobilePreviewPipelineKind(undefined)).toBe('shim');
    });

    // ── task #92 overlay-v1 kill switch ─────────────────────────────

    test('selects the overlay-v1 pipeline from NEXT_PUBLIC_MOBILE_PREVIEW_PIPELINE', () => {
        mockEnv.NEXT_PUBLIC_MOBILE_PREVIEW_PIPELINE = 'overlay-v1';
        expect(getMobilePreviewPipelineKind()).toBe('overlay-v1');
        expect(isMobilePreviewOverlayV1PipelineEnabled()).toBe(true);
        expect(isMobilePreviewTwoTierPipelineEnabled()).toBe(false);
    });

    test('isAnyMobilePreviewOverlayPipelineEnabled returns true for overlay-v1 AND legacy two-tier', () => {
        mockEnv.NEXT_PUBLIC_MOBILE_PREVIEW_PIPELINE = 'overlay-v1';
        expect(isAnyMobilePreviewOverlayPipelineEnabled()).toBe(true);
        mockEnv.NEXT_PUBLIC_MOBILE_PREVIEW_PIPELINE = 'two-tier';
        expect(isAnyMobilePreviewOverlayPipelineEnabled()).toBe(true);
        mockEnv.NEXT_PUBLIC_MOBILE_PREVIEW_PIPELINE = 'shim';
        expect(isAnyMobilePreviewOverlayPipelineEnabled()).toBe(false);
    });
});

import {
    MobilePreviewBundleError,
    type MobilePreviewBundleBudget,
} from './types';

export const MOBILE_PREVIEW_BUNDLE_WARNING_BYTES = 500 * 1024;
export const MOBILE_PREVIEW_BUNDLE_HARD_LIMIT_BYTES = 2 * 1024 * 1024;

export function evaluateMobilePreviewBundleBudget(
    code: string,
): MobilePreviewBundleBudget {
    const bytes = new TextEncoder().encode(code).byteLength;

    if (bytes > MOBILE_PREVIEW_BUNDLE_HARD_LIMIT_BYTES) {
        throw new MobilePreviewBundleError(
            `Mobile preview bundle is ${formatBundleSize(bytes)}, exceeding the hard limit of ${formatBundleSize(
                MOBILE_PREVIEW_BUNDLE_HARD_LIMIT_BYTES,
            )}. Reduce the bundle size before pushing to a device.`,
        );
    }

    return {
        bytes,
        warningThresholdBytes: MOBILE_PREVIEW_BUNDLE_WARNING_BYTES,
        hardLimitBytes: MOBILE_PREVIEW_BUNDLE_HARD_LIMIT_BYTES,
        warningMessage:
            bytes > MOBILE_PREVIEW_BUNDLE_WARNING_BYTES
                ? `Mobile preview bundle is ${formatBundleSize(
                      bytes,
                  )}. This exceeds the warning budget of ${formatBundleSize(
                      MOBILE_PREVIEW_BUNDLE_WARNING_BYTES,
                  )} and may slow device sync.`
                : null,
    };
}

function formatBundleSize(bytes: number): string {
    if (bytes >= 1024 * 1024) {
        const megabytes = bytes / (1024 * 1024);
        return `${trimTrailingZeroes(megabytes.toFixed(2))} MB`;
    }

    const kilobytes = bytes / 1024;
    return `${trimTrailingZeroes(kilobytes.toFixed(2))} KB`;
}

function trimTrailingZeroes(value: string): string {
    return value.replace(/\.00$/, '').replace(/(\.\d)0$/, '$1');
}

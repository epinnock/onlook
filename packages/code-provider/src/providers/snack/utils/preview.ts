/**
 * Snack preview URL utilities.
 *
 * Helpers for constructing Snack web-preview URLs, Expo Go deep-links,
 * QR-code data, and readiness checks.
 */

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SNACK_EMBEDDED_BASE = 'https://snack.expo.dev/embedded';
const FETCH_TIMEOUT_MS = 5_000;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build the embedded web-preview URL for a given Snack.
 *
 * Returns a URL of the form:
 *   `https://snack.expo.dev/embedded/@snack/{snackId}?preview=true&platform=web`
 *
 * An optional `sdkVersion` may be appended as an additional query parameter.
 */
export function getSnackWebPreviewUrl(snackId: string, sdkVersion?: string): string {
    const url = new URL(`${SNACK_EMBEDDED_BASE}/${snackId}`);
    url.searchParams.set('preview', 'true');
    url.searchParams.set('platform', 'web');
    if (sdkVersion) {
        url.searchParams.set('sdkVersion', sdkVersion);
    }
    return url.toString();
}

/**
 * Retrieve the Expo Go deep-link URL from a Snack SDK instance.
 *
 * Delegates directly to `snack.getUrlAsync()`.
 */
export async function getSnackExpoGoUrl(snack: {
    getUrlAsync(): Promise<string>;
}): Promise<string> {
    return snack.getUrlAsync();
}

/**
 * Build a string suitable for rendering as a QR code that opens the given
 * Expo URL in Expo Go.
 */
export function buildSnackQrCodeData(expoUrl: string): string {
    return expoUrl;
}

/**
 * Check whether the Snack preview at `url` is reachable.
 *
 * Performs a fetch with a timeout and returns `true` when the response
 * status is 200, `false` otherwise (network error, timeout, non-200).
 */
export async function isSnackPreviewReady(url: string): Promise<boolean> {
    try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

        const response = await fetch(url, { signal: controller.signal });
        clearTimeout(timer);

        return response.status === 200;
    } catch {
        return false;
    }
}

/**
 * Derive the Snack web-preview URL from a provider-level sandbox ID.
 *
 * If `sandboxId` starts with `"snack-"`, the prefix is stripped and the
 * remainder is treated as the Snack ID. Otherwise the full `sandboxId` is
 * used as-is.
 */
export function getSnackPreviewUrlForProvider(sandboxId: string): string {
    const snackId = sandboxId.startsWith('snack-') ? sandboxId.slice('snack-'.length) : sandboxId;
    return getSnackWebPreviewUrl(snackId);
}

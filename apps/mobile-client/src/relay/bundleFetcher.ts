/**
 * Bundle fetcher for the Onlook mobile client.
 *
 * Fetches a JS bundle from the relay host, validates the HTTP response, and
 * returns the bundle source string for `OnlookRuntime.runApplication()`.
 *
 * The caller resolves the bundle URL from the manifest's `launchAsset.url`
 * before calling `fetchBundle`.
 *
 * Returns a discriminated-union result (`BundleResult`) so the caller can
 * pattern-match on `ok` without try/catch — same pattern as MC3.11's
 * `ManifestResult`.
 *
 * Task: MC3.12
 */

/** Discriminated-union result type for bundle fetching. */
export type BundleResult =
    | { ok: true; source: string }
    | { ok: false; error: string };

/**
 * Known JavaScript content types that confirm the response is a JS bundle.
 * Some dev relays omit Content-Type entirely, which is allowed (with a
 * console warning). Non-JS Content-Types are also allowed but warned about.
 */
const JS_CONTENT_TYPES = ['application/javascript', 'text/javascript'];

/**
 * Fetch a JS bundle from the given URL.
 *
 * @param bundleUrl - Full URL of the bundle, typically from
 *   `manifest.launchAsset.url`.
 *
 * @returns A `BundleResult` — `{ ok: true, source }` on success, or
 *   `{ ok: false, error }` on network error, non-200 status, or empty body.
 *   Never throws.
 */
export async function fetchBundle(bundleUrl: string): Promise<BundleResult> {
    let response: Response;
    try {
        response = await fetch(bundleUrl, { method: 'GET' });
    } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        return { ok: false, error: `Network error: ${message}` };
    }

    if (!response.ok) {
        return {
            ok: false,
            error: `HTTP ${response.status}: ${response.statusText}`,
        };
    }

    // Warn (but don't reject) if Content-Type is missing or unexpected.
    const contentType = response.headers.get('content-type') ?? '';
    if (!contentType) {
        console.warn(
            '[bundleFetcher] Response has no Content-Type header — proceeding anyway',
        );
    } else if (!JS_CONTENT_TYPES.some((ct) => contentType.includes(ct))) {
        console.warn(
            `[bundleFetcher] Unexpected Content-Type "${contentType}" — expected application/javascript or text/javascript`,
        );
    }

    let source: string;
    try {
        source = await response.text();
    } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        return { ok: false, error: `Failed to read response body: ${message}` };
    }

    if (!source) {
        return { ok: false, error: 'Empty bundle response body' };
    }

    return { ok: true, source };
}

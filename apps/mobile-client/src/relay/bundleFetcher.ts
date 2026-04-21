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

interface HttpResponse {
    status: number;
    statusText: string;
    body: string;
    contentType: string;
}

function blog(msg: string): void {
    // Mirror of manifestFetcher's nlog — pipes through __onlookDirectLog
    // (installed by cpp/OnlookRuntimeInstaller) so log lines survive RN
    // bridgeless's nativeLoggingHook overwrite. See task #73 / #85.
    try {
        const gt = globalThis as unknown as {
            __onlookDirectLog?: (m: string, level: number) => void;
            nativeLoggingHook?: (m: string, level: number) => void;
        };
        const channel = gt.__onlookDirectLog ?? gt.nativeLoggingHook;
        channel?.(`[OM-bundle] ${msg}`, 1);
    } catch { /* diagnostic path must never throw */ }
}

function hasOnlookHttpGet(): boolean {
    const gt = globalThis as { OnlookRuntime?: { httpGet?: unknown } };
    return typeof gt.OnlookRuntime?.httpGet === 'function';
}

/**
 * Sync JSI GET via OnlookRuntime.httpGet. Bypasses RCTNetworking — same
 * escape hatch that manifestFetcher uses. See task #81 for why this is
 * needed on bridgeless iOS 18.6 (RN's fetch never dispatches response
 * events back to JS). Blocks the JS thread for the request duration;
 * bundles are typically <2MB so <500ms latency is acceptable.
 */
function fetchViaJsiHttpGet(url: string): HttpResponse {
    const gt = globalThis as {
        OnlookRuntime?: {
            httpGet?: (url: string, headers?: Record<string, string>) => {
                ok: boolean;
                status: number;
                body: string;
                contentType: string;
                error?: string;
            };
        };
    };
    const r = gt.OnlookRuntime!.httpGet!(url, {});
    if (r.error) {
        throw new Error(r.error);
    }
    return {
        status: r.status,
        statusText: r.ok ? 'OK' : 'Error',
        body: r.body,
        contentType: r.contentType,
    };
}

async function fetchViaFetch(url: string): Promise<HttpResponse> {
    const resp = await fetch(url, { method: 'GET' });
    return {
        status: resp.status,
        statusText: resp.statusText,
        body: await resp.text(),
        contentType: resp.headers.get('content-type') ?? '',
    };
}

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
    // Transport priority mirrors manifestFetcher (#82/#85): prefer the JSI
    // httpGet escape hatch when the native side is linked in; fall back to
    // fetch for bun-test and non-iOS targets. We skip XHR here because its
    // streaming-body API is redundant with the synchronous httpGet path and
    // is broken under RN bridgeless anyway.
    blog(`transport pick hasOnlook=${hasOnlookHttpGet()} url=${bundleUrl.slice(0, 120)}`);
    let resp: HttpResponse;
    try {
        resp = hasOnlookHttpGet()
            ? fetchViaJsiHttpGet(bundleUrl)
            : await fetchViaFetch(bundleUrl);
    } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        blog(`fetch threw: ${message}`);
        return { ok: false, error: `Network error: ${message}` };
    }
    blog(`status=${resp.status} bytes=${resp.body.length}`);

    if (resp.status < 200 || resp.status >= 300) {
        return {
            ok: false,
            error: `HTTP ${resp.status}: ${resp.statusText}`,
        };
    }

    // Warn (but don't reject) if Content-Type is missing or unexpected.
    // console.warn is preserved for bun-test contract; blog() adds the
    // sim-visible diagnostic via __onlookDirectLog.
    if (!resp.contentType) {
        console.warn(
            '[bundleFetcher] Response has no Content-Type header — proceeding anyway',
        );
        blog('response has no Content-Type header');
    } else if (!JS_CONTENT_TYPES.some((ct) => resp.contentType.includes(ct))) {
        console.warn(
            `[bundleFetcher] Unexpected Content-Type "${resp.contentType}" — expected application/javascript or text/javascript`,
        );
        blog(`unexpected Content-Type "${resp.contentType}"`);
    }

    if (!resp.body) {
        return { ok: false, error: 'Empty bundle response body' };
    }

    return { ok: true, source: resp.body };
}

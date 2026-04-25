/**
 * Asset-check protocol — task #65 (retargeted 2026-04-25 to match the
 * canonical relay endpoint, same audit pattern as `asset-uploader.ts`
 * commit `53bd29ff`).
 *
 * Before uploading an overlay's asset bytes to R2, the editor asks the
 * relay which content-hashes it already has. Only the unknown hashes
 * need to be uploaded; known ones are reused by URI.
 *
 * Wire (per-hash HEAD; fanned out in parallel):
 *   HEAD <relayBaseUrl>/base-bundle/assets/<hash>
 *      → 200 (known) | 404 (unknown) | other → unknown (safe default)
 *
 * Audit note: prior to 2026-04-25 this module POSTed to a bulk
 * `/assets/check` endpoint that the relay never had a route for. No
 * production caller invoked the function, so the mismatch was
 * invisible in production but would have broken the moment the editor
 * pipeline tried to use it. Caught during the same audit thread that
 * found the dead Monaco shim, the unwired reconnect-replayer, and the
 * uploadAsset endpoint mismatch.
 */

export interface AssetCheckOptions {
    readonly relayBaseUrl: string;
    readonly sessionId: string;
    readonly hashes: readonly string[];
    readonly fetchImpl?: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
    /** Per-request timeout. Each hash's HEAD has its own deadline. */
    readonly timeoutMs?: number;
    /**
     * Concurrency cap for parallel HEAD requests. Default 8 — well under
     * the browser's per-origin connection limit, leaves headroom for
     * other relay traffic (manifest, push, events poll). The unique
     * hash list is windowed in batches of this size.
     */
    readonly concurrency?: number;
}

export interface AssetCheckResult {
    readonly known: ReadonlySet<string>;
    readonly unknown: readonly string[];
}

/**
 * Ask the relay which of the given hashes it already has asset bytes for.
 * Returns sets of known + unknown. On network error or non-200/404
 * response, treats the hash as unknown (so the editor re-uploads — safe
 * default).
 */
export async function checkAssetHashes(
    options: AssetCheckOptions,
): Promise<AssetCheckResult> {
    const unique = Array.from(new Set(options.hashes));
    if (unique.length === 0) {
        return { known: new Set(), unknown: [] };
    }

    const fetchImpl = options.fetchImpl ?? globalThis.fetch;
    if (typeof fetchImpl !== 'function') {
        return { known: new Set(), unknown: unique };
    }

    const baseUrl = options.relayBaseUrl.replace(/\/+$/, '');
    const timeoutMs = options.timeoutMs ?? 5000;
    const concurrency = Math.max(1, options.concurrency ?? 8);

    async function checkOne(hash: string): Promise<{ hash: string; known: boolean }> {
        const url = `${baseUrl}/base-bundle/assets/${encodeURIComponent(hash)}`;
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        try {
            const resp = await fetchImpl(url, {
                method: 'HEAD',
                signal: controller.signal,
            });
            // 200 = exists in R2; 404 = missing. Anything else (5xx,
            // unexpected redirects) → safe-default to unknown so the
            // editor uploads.
            return { hash, known: resp.status === 200 };
        } catch {
            return { hash, known: false };
        } finally {
            clearTimeout(timer);
        }
    }

    // Window the parallel checks. Promise.all of all-at-once would
    // saturate the per-origin connection cap when uploading a large
    // overlay (image-heavy projects easily produce 50+ assets).
    const knownSet = new Set<string>();
    for (let i = 0; i < unique.length; i += concurrency) {
        const window = unique.slice(i, i + concurrency);
        const results = await Promise.all(window.map(checkOne));
        for (const r of results) {
            if (r.known) knownSet.add(r.hash);
        }
    }
    const unknown = unique.filter((h) => !knownSet.has(h));
    return { known: knownSet, unknown };
}

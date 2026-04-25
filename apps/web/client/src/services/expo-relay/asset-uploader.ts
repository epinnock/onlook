/**
 * Editor asset uploader — task #64 (retargeted 2026-04-25 to match the
 * canonical relay endpoint added in task #74).
 *
 * Computes sha256(bytes), PUTs the bytes to the relay's
 * `/base-bundle/assets/<hash>` endpoint, returns the R2 URI the asset
 * is durably reachable at. The editor typically calls `checkAssetHashes`
 * first to skip already-known hashes; this module is the upload step
 * for the novel ones.
 *
 * Wire:
 *   PUT  <relayBaseUrl>/base-bundle/assets/<hash>
 *        Content-Type: <mime>
 *        body: bytes
 *      → 201 (created) | 200 (overwrite); no JSON body
 *
 * The relay's PUT doesn't return a `uri` field — the editor derives the
 * GET URL from `<relayBaseUrl>/base-bundle/assets/<hash>` since asset
 * keys are content-addressed (sha256 hex) and the relay's GET / HEAD on
 * the same path serves them durably from R2. Caller embeds the derived
 * URI in `AssetDescriptor`.
 *
 * Audit note: prior to 2026-04-25 this module POSTed to
 * `/assets/upload/<hash>` — a path the relay never had a route for.
 * No production caller invoked the function (the editor pipeline didn't
 * yet depend on R2 upload), so the mismatch was invisible. Caught
 * during the same audit thread that found the dead Monaco shim, the
 * unwired reconnect-replayer, etc. — the editor uploader is now
 * pointed at a real endpoint.
 */

export interface UploadAssetOptions {
    readonly relayBaseUrl: string;
    readonly sessionId: string;
    readonly bytes: Uint8Array;
    readonly mime: string;
    /** sha256 hex. Callers precompute and pass through — often via `checkAssetHashes`. */
    readonly hash: string;
    readonly fetchImpl?: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
    readonly timeoutMs?: number;
}

export type UploadAssetResult =
    | { readonly ok: true; readonly uri: string; readonly hash: string }
    | { readonly ok: false; readonly hash: string; readonly error: string; readonly status?: number };

/** sha256 hex helper — exported so callers can precompute outside. */
export async function sha256HexOfBytes(bytes: Uint8Array): Promise<string> {
    const subtle = (globalThis as { crypto?: { subtle?: SubtleCrypto } }).crypto?.subtle;
    if (subtle) {
        // Cast to BufferSource — SubtleCrypto.digest's type params shifted
        // under recent lib.dom.d.ts (`Uint8Array<ArrayBufferLike>` vs
        // `BufferSource`). Runtime behavior is identical.
        const digest = await subtle.digest('SHA-256', bytes as unknown as BufferSource);
        return Array.from(new Uint8Array(digest))
            .map((b) => b.toString(16).padStart(2, '0'))
            .join('');
    }
    const { createHash } = await import('node:crypto');
    return createHash('sha256').update(bytes).digest('hex');
}

export async function uploadAsset(
    options: UploadAssetOptions,
): Promise<UploadAssetResult> {
    const fetchImpl = options.fetchImpl ?? globalThis.fetch;
    if (typeof fetchImpl !== 'function') {
        return { ok: false, hash: options.hash, error: 'fetch is not available' };
    }
    const baseUrl = options.relayBaseUrl.replace(/\/+$/, '');
    const url = `${baseUrl}/base-bundle/assets/${encodeURIComponent(options.hash)}`;
    const controller = new AbortController();
    const timer = setTimeout(
        () => controller.abort(),
        options.timeoutMs ?? 10_000,
    );
    try {
        const resp = await fetchImpl(url, {
            method: 'PUT',
            headers: {
                'Content-Type': options.mime || 'application/octet-stream',
                'X-Onlook-Session-Id': options.sessionId,
            },
            body: options.bytes as unknown as BodyInit,
            signal: controller.signal,
        });
        if (!resp.ok) {
            return {
                ok: false,
                hash: options.hash,
                error: `relay responded ${resp.status}`,
                status: resp.status,
            };
        }
        // The relay's PUT returns no body — derive the durable GET URI
        // from the hash + base URL. Asset keys are content-addressed so
        // this URI is stable and serves bytes via the same path's
        // GET/HEAD branches.
        return {
            ok: true,
            uri: url,
            hash: options.hash,
        };
    } catch (err) {
        return {
            ok: false,
            hash: options.hash,
            error: err instanceof Error ? err.message : 'network error',
        };
    } finally {
        clearTimeout(timer);
    }
}

/**
 * Convenience wrapper: given bytes + mime, compute sha256 internally, then
 * upload. Returns both the uri AND the hash so the caller can embed both in
 * an `AssetDescriptor`.
 */
export async function uploadAssetBytes(
    options: Omit<UploadAssetOptions, 'hash'>,
): Promise<UploadAssetResult> {
    const hash = await sha256HexOfBytes(options.bytes);
    return uploadAsset({ ...options, hash });
}

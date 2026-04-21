/**
 * Editor asset uploader — task #64.
 *
 * Computes sha256(bytes), POSTs the bytes to the relay's asset-upload
 * endpoint, returns the R2 URI to embed in an `AssetDescriptor`.
 *
 * The editor typically calls `checkAssetHashes` first to skip already-known
 * hashes; this module is the upload step for the novel ones.
 *
 * Wire:
 *   POST /assets/upload/:hash      (Content-Type: application/octet-stream)
 *      → 202 { uri: "https://r2/assets/<hash>" }
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
        const digest = await subtle.digest('SHA-256', bytes);
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
    const url = `${options.relayBaseUrl.replace(/\/+$/, '')}/assets/upload/${encodeURIComponent(options.hash)}`;
    const controller = new AbortController();
    const timer = setTimeout(
        () => controller.abort(),
        options.timeoutMs ?? 10_000,
    );
    try {
        const resp = await fetchImpl(url, {
            method: 'POST',
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
        const parsed = (await resp.json()) as { uri?: unknown };
        if (typeof parsed.uri !== 'string') {
            return {
                ok: false,
                hash: options.hash,
                error: 'relay returned no uri field',
            };
        }
        return { ok: true, uri: parsed.uri, hash: options.hash };
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

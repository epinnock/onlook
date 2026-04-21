/**
 * Asset-check protocol — task #65.
 *
 * Before uploading an overlay's asset bytes to R2, the editor asks the relay
 * which content-hashes it already has. Only the unknown hashes need to be
 * uploaded; known ones are reused by URI.
 *
 * The relay exposes `POST /assets/check` with body
 * `{ hashes: string[] }` and responds with `{ known: string[] }`. This
 * module is the editor-side client — pure JSON, no state.
 */

export interface AssetCheckOptions {
    readonly relayBaseUrl: string;
    readonly sessionId: string;
    readonly hashes: readonly string[];
    readonly fetchImpl?: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
    readonly timeoutMs?: number;
}

export interface AssetCheckResult {
    readonly known: ReadonlySet<string>;
    readonly unknown: readonly string[];
}

/**
 * Ask the relay which of the given hashes it already has asset bytes for.
 * Returns sets of known + unknown. On network error, returns everything as
 * unknown (so the editor re-uploads — safe default).
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

    const url = `${options.relayBaseUrl.replace(/\/+$/, '')}/assets/check`;
    const controller = new AbortController();
    const timer = setTimeout(
        () => controller.abort(),
        options.timeoutMs ?? 5000,
    );
    try {
        const resp = await fetchImpl(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sessionId: options.sessionId, hashes: unique }),
            signal: controller.signal,
        });
        if (!resp.ok) {
            return { known: new Set(), unknown: unique };
        }
        const parsed = (await resp.json()) as { known?: string[] };
        const knownSet = new Set<string>(
            Array.isArray(parsed.known) ? parsed.known : [],
        );
        const unknown = unique.filter((h) => !knownSet.has(h));
        return { known: knownSet, unknown };
    } catch {
        return { known: new Set(), unknown: unique };
    } finally {
        clearTimeout(timer);
    }
}

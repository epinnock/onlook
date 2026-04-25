/**
 * remote-pure-js-cache — editor-side cache fetcher for tasks #47 + #48.
 *
 * Wraps a `fetch`-style HTTP fetcher in the `PureJsArtifactCache` interface
 * so the bundler can consume remote artifacts transparently. Typical wiring:
 *
 *   const memoryCache = createInMemoryPureJsCache();
 *   const remoteCache = createRemotePureJsCache({
 *     baseUrl: 'https://cdn.onlook.test/artifacts/',
 *     fetchImpl: globalThis.fetch,
 *   });
 *   const cache = createLayeredPureJsCache(memoryCache, remoteCache);
 *
 * Cache layout on the server:
 *
 *   GET  <baseUrl><name>/<version>.json  → PureJsPackageArtifact (JSON body)
 *   PUT  <baseUrl><name>/<version>.json  → 201/200 (editor uploads)
 *   HEAD <baseUrl><name>/<version>.json  → 200 present / 404 missing
 *
 * The fetcher is unopinionated about auth: callers can pre-bind headers
 * (bearer token, Cloudflare Access) via a wrapped `fetchImpl`.
 */

import type { PureJsArtifactCache, PureJsPackageArtifact } from './pure-js-package';

export interface RemotePureJsCacheOptions {
    /**
     * Base URL of the artifact cache. Must end with a path separator.
     * Passing `'https://cdn.test/artifacts'` (no trailing slash) is normalized
     * so both forms produce the same final URLs.
     */
    readonly baseUrl: string | URL;
    readonly fetchImpl?: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
    /** Optional request timeout in ms — applied via AbortController. No default. */
    readonly timeoutMs?: number;
}

/**
 * Remote cache has a richer `put` return (HTTP status → boolean) than
 * `PureJsArtifactCache.put`. It's structurally a `LayeredCacheFast` so
 * `createLayeredPureJsCache(remote, slower)` works directly.
 */
export interface RemotePureJsCache {
    get(packageName: string, version: string): Promise<PureJsPackageArtifact | null>;
    /**
     * Write an artifact to the remote. Returns true on 2xx, false otherwise.
     * The bundler uses `put` to upload pure-JS package artifacts it built.
     */
    put(artifact: PureJsPackageArtifact): Promise<boolean>;
    /**
     * Cheap existence check (HTTP HEAD). Callers can skip a full body fetch
     * when they only need "do we have this version cached?".
     */
    has(name: string, version: string): Promise<boolean>;
}

export function createRemotePureJsCache(
    options: RemotePureJsCacheOptions,
): RemotePureJsCache {
    const base = normalizeBaseUrl(options.baseUrl);
    const fetchImpl = options.fetchImpl ?? globalThis.fetch;
    if (typeof fetchImpl !== 'function') {
        throw new Error(
            'createRemotePureJsCache: no fetch implementation (pass options.fetchImpl or polyfill globalThis.fetch)',
        );
    }

    async function doFetch(
        pathAndQuery: string,
        init?: RequestInit,
    ): Promise<Response> {
        const url = new URL(pathAndQuery, base);
        if (options.timeoutMs === undefined) {
            return fetchImpl(url.toString(), init);
        }
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), options.timeoutMs);
        try {
            return await fetchImpl(url.toString(), {
                ...init,
                signal: controller.signal,
            });
        } finally {
            clearTimeout(timer);
        }
    }

    return {
        async get(name, version) {
            const response = await doFetch(artifactPath(name, version));
            if (response.status === 404) return null;
            if (!response.ok) {
                throw new Error(
                    `remote-pure-js-cache: GET ${name}@${version} failed — ${response.status} ${response.statusText}`,
                );
            }
            const json = (await response.json()) as PureJsPackageArtifact;
            if (json.packageName !== name || json.version !== version) {
                throw new Error(
                    `remote-pure-js-cache: artifact body mismatch — requested ${name}@${version}, got ${json.packageName}@${json.version}`,
                );
            }
            return json;
        },
        async put(artifact) {
            const response = await doFetch(
                artifactPath(artifact.packageName, artifact.version),
                {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(artifact),
                },
            );
            return response.ok;
        },
        async has(name, version) {
            const response = await doFetch(artifactPath(name, version), {
                method: 'HEAD',
            });
            return response.ok;
        },
    };
}

/**
 * Compose two caches so the bundler checks the fast one first, then falls
 * back to the slow one. On a cache-miss-then-hit, the fast cache is
 * populated so subsequent lookups short-circuit.
 *
 * The returned cache's `put()` writes to the fast layer only — the slow
 * layer (usually a remote cache) is assumed to be populated out-of-band
 * by whatever process builds artifacts.
 */
export interface LayeredCacheFast {
    get(packageName: string, version: string): Promise<PureJsPackageArtifact | null>;
    put(artifact: PureJsPackageArtifact): Promise<void | boolean>;
}

export interface LayeredCacheSlow {
    get(packageName: string, version: string): Promise<PureJsPackageArtifact | null>;
}

export function createLayeredPureJsCache(
    fast: LayeredCacheFast,
    slow: LayeredCacheSlow,
): PureJsArtifactCache {
    return {
        async get(name, version) {
            const fromFast = await fast.get(name, version);
            if (fromFast !== null) return fromFast;
            const fromSlow = await slow.get(name, version);
            if (fromSlow !== null) {
                // Populate the fast cache opportunistically — ignore put failures.
                try {
                    await fast.put(fromSlow);
                } catch {
                    // Fast-cache write failures are non-fatal; we already have the artifact.
                }
            }
            return fromSlow;
        },
        async put(artifact) {
            await fast.put(artifact);
        },
    };
}

// ─── helpers ────────────────────────────────────────────────────────────────

function normalizeBaseUrl(input: string | URL): URL {
    const url = new URL(input.toString());
    if (!url.pathname.endsWith('/')) {
        url.pathname = `${url.pathname}/`;
    }
    return url;
}

function artifactPath(name: string, version: string): string {
    // Package names can contain scoped-org `/` (e.g. `@scope/pkg`) — encode
    // per-segment so cache servers that parse path components don't mis-route.
    const safeName = name
        .split('/')
        .map((segment) => encodeURIComponent(segment))
        .join('/');
    const safeVersion = encodeURIComponent(version);
    return `${safeName}/${safeVersion}.json`;
}

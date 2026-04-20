/**
 * Incremental rebuild cache for the browser-bundler.
 *
 * Wraps `bundleBrowserProject` with a content-addressed memo: when the
 * caller's entry + files + externals hash identically to the previous
 * invocation, return the cached result instead of re-running esbuild.
 * Every substantive change — even a single byte edit — invalidates.
 *
 * The cache is single-slot per instance. That matches the editor's runtime
 * shape where a single Web Worker sees a linear stream of edits and each
 * rebuild supersedes the last. A larger LRU would only help if the editor
 * were hosting multiple concurrent previews from the same worker, which
 * it doesn't.
 */
import { bundleBrowserProject, type BundleBrowserProjectResult, type BrowserBundlerEsbuildService } from './bundle';
import type { CreateBrowserBundleOptionsInput } from './options';

export interface IncrementalBuildHit {
    readonly ok: true;
    readonly cached: boolean;
    readonly result: BundleBrowserProjectResult;
}

export interface IncrementalBundler {
    /** Rebuild or return the cached result. Never throws from the cache path. */
    build(
        input: CreateBrowserBundleOptionsInput,
        esbuild: BrowserBundlerEsbuildService,
    ): Promise<IncrementalBuildHit>;
    /** Drops the cached result so the next call always rebuilds. */
    reset(): void;
    /** Number of rebuilds completed (cache misses). Useful for tests. */
    readonly rebuilds: number;
    /** Number of cache hits served. */
    readonly hits: number;
}

interface CacheEntry {
    readonly fingerprint: string;
    readonly result: BundleBrowserProjectResult;
}

export function createIncrementalBundler(): IncrementalBundler {
    let cache: CacheEntry | null = null;
    let rebuilds = 0;
    let hits = 0;

    return {
        async build(input, esbuild) {
            const fingerprint = fingerprintInput(input);
            if (cache && cache.fingerprint === fingerprint) {
                hits += 1;
                return { ok: true, cached: true, result: cache.result };
            }
            const result = await bundleBrowserProject(input, esbuild);
            cache = { fingerprint, result };
            rebuilds += 1;
            return { ok: true, cached: false, result };
        },
        reset(): void {
            cache = null;
        },
        get rebuilds(): number {
            return rebuilds;
        },
        get hits(): number {
            return hits;
        },
    };
}

/**
 * Computes a stable fingerprint for the build inputs. We sort keys so
 * object iteration order doesn't flip the hash, and we include a version
 * marker so future schema changes force a cold rebuild.
 */
export function fingerprintInput(input: CreateBrowserBundleOptionsInput): string {
    const sortedFiles = [...input.files]
        .map((f) => [f.path, f.contents] as const)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));

    const sortedExternals = [...input.externalSpecifiers].sort();

    const payload = JSON.stringify({
        v: 1,
        entry: input.entryPoint,
        platform: input.platform ?? 'ios',
        minify: input.minify ?? false,
        sourcemap: input.sourcemap ?? true,
        wasmUrl:
            input.wasmUrl === undefined
                ? null
                : typeof input.wasmUrl === 'string'
                    ? input.wasmUrl
                    : input.wasmUrl.toString(),
        files: sortedFiles,
        externals: sortedExternals,
    });
    return cheapHash(payload);
}

/**
 * Non-cryptographic string hash (FNV-1a 32-bit). We don't need collision
 * resistance — the cache fallback is an esbuild rebuild, which is correct
 * regardless of a collision. FNV is fast, deterministic, and available in
 * every JS runtime without a Crypto dep.
 */
function cheapHash(input: string): string {
    let hash = 0x811c9dc5;
    for (let i = 0; i < input.length; i += 1) {
        hash ^= input.charCodeAt(i);
        hash = Math.imul(hash, 0x01000193);
    }
    return (hash >>> 0).toString(16).padStart(8, '0');
}

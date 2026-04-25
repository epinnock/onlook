/**
 * local-esm-cache-shared.ts — pure helpers reused by both the standalone
 * HTTP server (local-esm-cache.ts, needs node:fs) and the wrangler-dev
 * worker variant (local-esm-cache-worker.ts, workerd has no node:fs).
 *
 * Keep this module free of node imports so workerd can bundle it.
 */

export const HEX64 = /^[0-9a-f]{64}$/;
export const BUNDLE_ROUTE =
    /^\/bundle\/([^/]+)\/(manifest-fields\.json|meta\.json|index\.(?:ios|android)\.bundle)$/;

export function defaultManifestFields(hash: string): Record<string, unknown> {
    return {
        runtimeVersion: '1',
        launchAsset: {
            key: `b-${hash.slice(0, 16)}`,
            contentType: 'application/javascript',
        },
        assets: [],
        metadata: {},
        extra: {
            expoClient: {
                name: 'onlook-local-dev',
                slug: 'onlook-local-dev',
                version: '1.0.0',
                sdkVersion: '54.0.0',
                platforms: ['ios', 'android'],
                newArchEnabled: true,
            },
            scopeKey: 'onlook-local-dev',
        },
    };
}

export function defaultMeta(): Record<string, unknown> {
    return { builtAt: new Date().toISOString() };
}

export function defaultBundle(): string {
    return '// local-esm-cache placeholder bundle — override with a real file on disk\n';
}

export function contentTypeFor(kind: string): string {
    if (kind.endsWith('.json')) return 'application/json; charset=utf-8';
    if (kind.endsWith('.bundle')) return 'application/javascript; charset=utf-8';
    return 'application/octet-stream';
}

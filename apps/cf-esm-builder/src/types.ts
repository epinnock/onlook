/**
 * Shared TypeScript types for the cf-esm-builder Worker.
 *
 * Source of truth for the editor ↔ builder HTTP protocol defined in
 * `plans/expo-browser-builder-protocol.md` (TH0.2). The editor-side mirror
 * lives in `apps/web/client/src/services/expo-builder/types.ts` (TH4.1) and
 * must match these shapes byte-for-byte.
 */

export interface Env {
    ESM_BUILDER: DurableObjectNamespace;
    BUILD_SESSION?: DurableObjectNamespace;
    BUNDLES?: R2Bucket;
}

export interface BuildRequestHeaders {
    'Content-Type': 'application/x-tar' | 'application/gzip';
    'X-Project-Id': string;
    'X-Branch-Id': string;
}

export interface BuildResponse {
    buildId: string;
    sourceHash: string;
    cached: boolean;
}

export type BuildState = 'pending' | 'building' | 'ready' | 'failed';

export interface BuildStatus {
    state: BuildState;
    sourceHash: string;
    bundleHash?: string;
    bundleSize?: number;
    builtAt?: string;
    error?: string;
}

export interface HealthResponse {
    ok: boolean;
    version: string;
    container: 'ready' | 'missing';
}

export interface BuildError {
    error: string;
}

/**
 * Editor-side mirror of the cf-esm-builder HTTP protocol types.
 *
 * IMPORTANT: These interfaces MUST stay in sync with
 * `apps/cf-esm-builder/src/types.ts` (TH2.0). The protocol is defined in
 * `plans/expo-browser-builder-protocol.md` (TH0.2) and is the source of
 * truth.
 *
 * The definitions are duplicated here (rather than re-exported via a
 * relative workspace path) because `apps/web/client/tsconfig.json` does
 * not `include` the `apps/cf-esm-builder` sources, so a direct
 * relative import would break the editor typecheck. Any change to the
 * cf-esm-builder types MUST be mirrored in this file.
 */

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

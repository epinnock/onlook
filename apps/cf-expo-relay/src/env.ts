import type { ExpoSession } from './session';

/** Minimal shape of a Worker service binding (ESM_CACHE) for typing only. */
export interface ServiceBinding {
    fetch: (request: Request) => Promise<Response>;
}

export interface Env {
    BUNDLES: KVNamespace;
    BASE_BUNDLES?: R2Bucket;
    EXPO_SESSION: DurableObjectNamespace<ExpoSession>;
    ESM_CACHE?: ServiceBinding;
    ESM_CACHE_URL: string;
}

export type BaseBundleRouteEnv = Env & {
    BASE_BUNDLES: R2Bucket;
};

export function assertBaseBundlesEnv(
    env: Env,
    route: string,
): asserts env is BaseBundleRouteEnv {
    if (!env.BASE_BUNDLES) {
        throw new Error(`expo-relay: missing BASE_BUNDLES binding for ${route}`);
    }
}

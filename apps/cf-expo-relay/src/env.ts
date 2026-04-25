import type { ExpoSession } from './session';
import type { HmrSession } from './do/hmr-session';
import type { EventsSession } from './do/events-session';

/** Minimal shape of a Worker service binding (ESM_CACHE) for typing only. */
export interface ServiceBinding {
    fetch: (request: Request) => Promise<Response>;
}

export interface Env {
    BUNDLES: KVNamespace;
    BASE_BUNDLES?: R2Bucket;
    EXPO_SESSION: DurableObjectNamespace<ExpoSession>;
    HMR_SESSION?: DurableObjectNamespace<HmrSession>;
    EVENTS_SESSION?: DurableObjectNamespace<EventsSession>;
    ESM_CACHE?: ServiceBinding;
    ESM_CACHE_URL: string;
    /**
     * Comma-separated list of editor origins allowed to POST /push. If
     * unset, every origin is reflected — intended for local dev. In
     * production, configure this via `wrangler secret put ALLOWED_PUSH_ORIGINS`
     * so only the deployed editor domain(s) can publish overlays.
     */
    ALLOWED_PUSH_ORIGINS?: string;
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

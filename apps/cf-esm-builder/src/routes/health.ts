/**
 * GET /health — liveness probe used by `scripts/dev-builder.sh` (TH0.4) and
 * the editor-side prober (TH4.x). Returns the exact `HealthResponse` shape
 * defined in `plans/expo-browser-builder-protocol.md` (TH0.2).
 *
 * Behavior (TH2.4):
 * - `version` is a hard-coded module constant. Bump it per release; the
 *   editor uses this string to surface protocol-skew warnings.
 * - `container` reports `'ready'` when `env.CONTAINER` is bound (TH1.4 wires
 *   the actual Cloudflare Container binding) and `'missing'` otherwise so
 *   the dev script can degrade gracefully when running without containers.
 * - `Cache-Control: no-cache, no-store` so intermediaries never serve a
 *   stale liveness result.
 */
import type { Env, HealthResponse } from '../types';

const VERSION = '0.1.0';

export async function handleHealth(_request: Request, env: Env): Promise<Response> {
    const containerStatus = await checkContainer(env);
    const body: HealthResponse = {
        ok: true,
        version: VERSION,
        container: containerStatus,
    };
    return Response.json(body, {
        headers: { 'Cache-Control': 'no-cache, no-store' },
    });
}

async function checkContainer(env: Env): Promise<'ready' | 'missing'> {
    return env.CONTAINER != null ? 'ready' : 'missing';
}

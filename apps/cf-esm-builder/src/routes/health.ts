/**
 * GET /health — liveness probe used by `scripts/dev-builder.sh` (TH0.4).
 * Returns the exact `HealthResponse` shape from the protocol spec.
 */
import type { Env, HealthResponse } from '../types';

export async function handleHealth(request: Request, env: Env): Promise<Response> {
    const body: HealthResponse = { ok: true, version: '0.0.0', container: 'missing' };
    return Response.json(body);
}

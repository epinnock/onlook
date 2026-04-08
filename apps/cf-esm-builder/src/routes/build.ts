/**
 * POST /build — uploads a project source tar and returns a cache-hit or
 * enqueues a Container build session. Implemented in TH2.1.
 */
import type { Env } from '../types';

export async function handleBuild(request: Request, env: Env): Promise<Response> {
    return new Response('TODO: TH2.1', { status: 501 });
}

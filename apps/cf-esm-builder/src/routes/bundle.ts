/**
 * GET /bundle/:hash — serves Hermes bundle bytes from R2. Implemented in TH2.3.
 */
import type { Env } from '../types';

export async function handleBundle(request: Request, env: Env): Promise<Response> {
    return new Response('TODO: TH2.3', { status: 501 });
}

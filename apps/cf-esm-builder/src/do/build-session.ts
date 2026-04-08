/**
 * BuildSession Durable Object — owns one in-flight Container build session.
 *
 * Implemented in TH2.2 (state machine: pending → building → ready | failed).
 */
import type { Env } from '../types';

export class BuildSession {
    constructor(
        private readonly state: DurableObjectState,
        private readonly env: Env,
    ) {}

    async fetch(request: Request): Promise<Response> {
        return new Response('TODO: TH2.2', { status: 501 });
    }
}

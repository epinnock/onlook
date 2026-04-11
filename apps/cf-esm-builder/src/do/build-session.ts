/**
 * BuildSession Durable Object — owns one in-flight Container build session.
 *
 * State machine (TH0.2 / TH2.2):
 *
 *     pending ──► building ──► ready
 *                          └─► failed
 *
 * The DO is keyed by `sourceHash` so concurrent `POST /build` calls for the
 * same source coalesce onto a single in-flight build. On a duplicate
 * `/start` we simply re-issue the existing state rather than kicking a new
 * Container.
 *
 * Note: this TH2.2 implementation owns the state-machine plumbing only.
 * The actual Container dispatch + R2 write lives in TH1.4 / TH2.4, which
 * will plug into the `building → ready|failed` transition point below.
 */
import type { Env } from '../types';

interface BuildSessionState {
    sourceHash: string;
    state: 'pending' | 'building' | 'ready' | 'failed';
    bundleHash?: string;
    error?: string;
    builtAt?: string;
    sizeBytes?: number;
    projectId?: string;
    branchId?: string;
}

function jsonResponse(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json' },
    });
}

export class BuildSession {
    constructor(
        private readonly state: DurableObjectState,
        private readonly env: Env,
    ) {}

    async fetch(request: Request): Promise<Response> {
        const url = new URL(request.url);
        if (url.pathname === '/start' && request.method === 'POST') {
            return this.handleStart(request);
        }
        if (url.pathname === '/status' && request.method === 'GET') {
            return this.handleStatus();
        }
        return new Response('not found', { status: 404 });
    }

    private async handleStart(request: Request): Promise<Response> {
        const url = new URL(request.url);
        const sourceHash = url.searchParams.get('sourceHash');
        const projectId = url.searchParams.get('projectId');
        const branchId = url.searchParams.get('branchId');

        if (!sourceHash || !projectId || !branchId) {
            return jsonResponse({ error: 'missing params' }, 400);
        }

        // Idempotent: if we already have state for this hash, re-issue it
        // instead of kicking a fresh build. This is how concurrent POSTs of
        // the same source coalesce at the DO boundary.
        const existing = await this.state.storage.get<BuildSessionState>('state');
        if (existing && existing.sourceHash === sourceHash) {
            return jsonResponse({
                buildId: sourceHash,
                sourceHash,
                cached: existing.state === 'ready',
                state: existing.state,
            });
        }

        // Fresh build: seed `pending`, then transition to `building`. The
        // TH1.4 Container hook (or a TH2.4 test harness) is responsible for
        // advancing this to `ready` / `failed` and writing R2 artefacts.
        const initial: BuildSessionState = {
            sourceHash,
            state: 'pending',
            projectId,
            branchId,
        };
        await this.state.storage.put('state', initial);
        await this.state.storage.put('state', { ...initial, state: 'building' });

        return jsonResponse({
            buildId: sourceHash,
            sourceHash,
            cached: false,
            state: 'building',
        });
    }

    private async handleStatus(): Promise<Response> {
        const current = await this.state.storage.get<BuildSessionState>('state');
        if (!current) {
            return jsonResponse({ error: 'no build' }, 404);
        }
        return jsonResponse({
            state: current.state,
            sourceHash: current.sourceHash,
            bundleHash: current.bundleHash,
            error: current.error,
            builtAt: current.builtAt,
            sizeBytes: current.sizeBytes,
        });
    }
}

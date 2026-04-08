/**
 * cf-esm-builder Worker.
 *
 * Entry point for the Expo browser-side Hermes build pipeline. The Worker
 * owns a small hand-rolled router that dispatches the three public endpoints
 * locked in `plans/expo-browser-builder-protocol.md` (TH0.2):
 *
 *   GET  /health                      -> liveness probe (TH2.4)
 *   POST /build                       -> upload source tar, get buildId (TH2.1)
 *   GET  /bundle/<hash>[/<file>]      -> serve bundle/artifacts from R2 (TH2.3)
 *   HEAD /bundle/<hash>[/<file>]      -> headers-only variant (TH2.3)
 *
 * The router is intentionally hand-rolled — no hono, no itty-router — to
 * keep the deploy bundle minimal and the failure surface small. TH2.6 wires
 * the routes; the handlers themselves live under `./routes/*`.
 *
 * Durable Object exports:
 *   - `EsmBuilder`   — legacy Container DO retained so the existing
 *                      `wrangler.jsonc` binding keeps working during the
 *                      TH1.x Container migration.
 *   - `BuildSession` — TH2.2 session DO, keyed by sourceHash, owns one
 *                      in-flight Container build.
 */
import { DurableObject } from 'cloudflare:workers';
import { handleBuild } from './routes/build';
import { handleBundle } from './routes/bundle';
import { handleHealth } from './routes/health';
import type { Env } from './types';

export { BuildSession } from './do/build-session';

export class EsmBuilder extends DurableObject<Env> {
    // Container idle-sleep timeout. The low-level `ctx.container.start()` API
    // in `@cloudflare/workers-types` does not accept a `sleepAfter` option
    // (that lives on the higher-level `@cloudflare/containers` Container
    // helper). The intended 2-minute idle sleep should be enforced either by
    // upgrading to the Container helper or by scheduling a manual destroy via
    // `ctx.container?.destroy()` after inactivity. Tracked for follow-up.
    override async fetch(request: Request): Promise<Response> {
        if (this.ctx.container && !this.ctx.container.running) {
            this.ctx.container.start({ enableInternet: true });
        }
        const port = this.ctx.container?.getTcpPort(5200);
        if (!port) {
            return new Response('Container unavailable', { status: 503 });
        }
        return port.fetch(request);
    }
}

export default {
    async fetch(request: Request, env: Env): Promise<Response> {
        const url = new URL(request.url);
        const path = url.pathname;
        const method = request.method;

        try {
            if (path === '/health' && method === 'GET') {
                return await handleHealth(request, env);
            }
            if (path === '/build' && method === 'POST') {
                return await handleBuild(request, env);
            }
            // /bundle/:hash  or  /bundle/:hash/:filename
            if (path.startsWith('/bundle/') && (method === 'GET' || method === 'HEAD')) {
                return await handleBundle(request, env);
            }
            return new Response('not found', { status: 404 });
        } catch (err) {
            console.error('[worker]', err);
            return Response.json(
                { error: err instanceof Error ? err.message : String(err) },
                { status: 500 },
            );
        }
    },
} satisfies ExportedHandler<Env>;

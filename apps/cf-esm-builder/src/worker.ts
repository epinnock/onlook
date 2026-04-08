/**
 * cf-esm-builder Worker.
 *
 * Wraps a Cloudflare Container running the `reactnative-esm` build pipeline
 * (npm install + esbuild) for individual npm packages.
 *
 * Routes:
 *   GET /pkg/<package>  -> returns the bundled ESM for that npm package.
 *   *                   -> 404
 *
 * The `cf-esm-cache` Worker sits in front of this one and handles R2 caching;
 * this Worker simply proxies requests into a singleton Durable Object that
 * owns the Container instance.
 */
import { DurableObject } from 'cloudflare:workers';
import { handleBuild } from './routes/build';
import { handleBundle } from './routes/bundle';
import { handleHealth } from './routes/health';
import { sha256OfTar } from './lib/hash';
import { r2GetBundle, r2PutBundle } from './lib/r2';
import { BuildSession } from './do/build-session';

export interface Env {
    ESM_BUILDER: DurableObjectNamespace<EsmBuilder>;
}

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
        const id = env.ESM_BUILDER.idFromName('default');
        const stub = env.ESM_BUILDER.get(id);
        return stub.fetch(request);
    },
} satisfies ExportedHandler<Env>;

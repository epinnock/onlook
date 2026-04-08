/**
 * `POST /invalidate` — drops one bundle hash from the R2 cache.
 *
 * Request body: `{ "hash": "<bundleHash>" }`
 *
 * Used by `cf-esm-builder` after a fresh build to ensure clients holding a
 * matching ETag pull the new artifact instead of the old cached one. Listing
 * under the `bundle/<hash>/` prefix lets us delete every sibling artifact
 * (`index.android.bundle`, `assetmap.json`, `sourcemap.json`,
 * `manifest-fields.json`, `meta.json`) in a single round-trip.
 *
 * Implements TH3.2 of `plans/expo-browser-e2e-task-queue.md`.
 */
import type { Env } from '../worker';

interface InvalidateRequest {
    hash?: unknown;
}

export async function handleInvalidate(request: Request, env: Env): Promise<Response> {
    let body: InvalidateRequest;
    try {
        body = (await request.json()) as InvalidateRequest;
    } catch {
        return Response.json({ error: 'invalid json' }, { status: 400 });
    }
    if (typeof body.hash !== 'string' || body.hash.length === 0) {
        return Response.json({ error: 'missing hash' }, { status: 400 });
    }

    const prefix = `bundle/${body.hash}/`;
    const list = await env.BUNDLES.list({ prefix });
    if (list.objects.length === 0) {
        return Response.json({ ok: true, deleted: 0 });
    }

    await env.BUNDLES.delete(list.objects.map((o) => o.key));
    return Response.json({ ok: true, deleted: list.objects.length });
}

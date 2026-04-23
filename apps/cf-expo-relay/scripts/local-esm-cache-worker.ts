/**
 * local-esm-cache-worker.ts — Worker-style entry for the cf-esm-cache
 * stand-in. Runs via `wrangler dev --name cf-esm-cache` so cf-expo-relay's
 * `ESM_CACHE` service binding resolves inside workerd instead of trying to
 * fetch loopback (workerd's local mode doesn't route localhost fetches
 * back to the host).
 *
 * Serves the same routes + fallback synthesis as `local-esm-cache.ts`:
 *   GET /bundle/:hash/manifest-fields.json
 *   GET /bundle/:hash/meta.json
 *   GET /bundle/:hash/index.ios.bundle
 *   GET /bundle/:hash/index.android.bundle
 *   GET /status
 *
 * Without filesystem access (workerd doesn't bind node:fs), this worker
 * ALWAYS returns the synthesized defaults — sufficient for the v2
 * events-channel smoke. If a real bundle needs to land in workerd, add an
 * R2 binding and adjust this handler accordingly.
 */

import {
    BUNDLE_ROUTE,
    HEX64,
    contentTypeFor,
    defaultManifestFields,
    defaultMeta,
} from './local-esm-cache-shared.ts';

export default {
    async fetch(request: Request): Promise<Response> {
        const url = new URL(request.url);
        if (request.method === 'GET' && url.pathname === '/status') {
            return new Response('ok', {
                status: 200,
                headers: { 'content-type': 'text/plain' },
            });
        }
        if (request.method !== 'GET') {
            return new Response('local-esm-cache-worker: method not allowed', {
                status: 405,
            });
        }
        const match = url.pathname.match(BUNDLE_ROUTE);
        if (!match) {
            return new Response('local-esm-cache-worker: not found', { status: 404 });
        }
        const hash = match[1] ?? '';
        const kind = match[2] ?? '';
        if (!HEX64.test(hash)) {
            return new Response('local-esm-cache-worker: invalid hash', { status: 400 });
        }
        const body =
            kind === 'manifest-fields.json'
                ? JSON.stringify(defaultManifestFields(hash))
                : kind === 'meta.json'
                  ? JSON.stringify(defaultMeta())
                  : '// local-esm-cache-worker placeholder bundle\n';
        return new Response(body, {
            status: 200,
            headers: {
                'content-type': contentTypeFor(kind),
                'cache-control': 'no-store',
                'x-local-esm-cache': 'synthesized',
            },
        });
    },
};

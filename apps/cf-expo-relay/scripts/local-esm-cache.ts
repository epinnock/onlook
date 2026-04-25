#!/usr/bin/env bun
/**
 * local-esm-cache.ts — minimal HTTP stand-in for cf-esm-cache during local dev.
 *
 * Serves the shape `cf-expo-relay` expects at `ESM_CACHE_URL` (default
 * http://127.0.0.1:8789):
 *
 *   GET /bundle/:hash/manifest-fields.json  → JSON ManifestFields
 *   GET /bundle/:hash/meta.json             → JSON { builtAt: string }
 *   GET /bundle/:hash/index.ios.bundle      → application/javascript
 *   GET /bundle/:hash/index.android.bundle  → application/javascript
 *   GET /status                             → plain "ok"
 *
 * Content root defaults to `/tmp/cf-builds/` (mirroring cf-esm-builder's real
 * layout). Each `<hash>/` subdir under the root should contain whatever files
 * the builder would have written. For the v2 demo, the minimum is:
 *
 *   /tmp/cf-builds/<hash>/manifest-fields.json
 *   /tmp/cf-builds/<hash>/index.ios.bundle
 *
 * Run:
 *   bun run apps/cf-expo-relay/scripts/local-esm-cache.ts [--port 8789] [--root /tmp/cf-builds]
 *
 * When any hash isn't present on disk, the script synthesises a "dev-friendly"
 * manifest-fields.json so the cf-expo-relay route can still build a valid
 * Expo manifest — useful for /events smoke tests that don't actually need a
 * mounted bundle.
 *
 * This is a development tool only. Production serves real cf-esm-cache.
 */

import { existsSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

import {
    BUNDLE_ROUTE,
    HEX64,
    contentTypeFor,
    defaultBundle,
    defaultManifestFields,
    defaultMeta,
} from './local-esm-cache-shared.ts';

type Args = { port: number; root: string };

function parseArgs(argv: string[]): Args {
    let port = 8789;
    let root = '/tmp/cf-builds';
    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i] ?? '';
        if (arg === '--port') {
            port = Number(argv[i + 1]);
            i += 1;
            if (!Number.isFinite(port)) throw new Error(`--port expects a number; got ${argv[i]}`);
        } else if (arg.startsWith('--port=')) {
            port = Number(arg.slice('--port='.length));
            if (!Number.isFinite(port)) throw new Error(`--port expects a number; got ${arg}`);
        } else if (arg === '--root') {
            root = resolve(argv[i + 1] ?? '');
            i += 1;
        } else if (arg.startsWith('--root=')) {
            root = resolve(arg.slice('--root='.length));
        }
    }
    return { port, root };
}

function serve({ port, root }: Args): void {
    const startedAt = Date.now();
    let served = 0;
    const server = Bun.serve({
        port,
        hostname: '0.0.0.0',
        fetch(request: Request): Response {
            const url = new URL(request.url);
            served += 1;

            if (request.method === 'GET' && url.pathname === '/status') {
                return new Response('ok', {
                    status: 200,
                    headers: { 'content-type': 'text/plain' },
                });
            }

            if (request.method !== 'GET') {
                return new Response('local-esm-cache: method not allowed', { status: 405 });
            }

            const match = url.pathname.match(BUNDLE_ROUTE);
            if (!match) {
                return new Response('local-esm-cache: not found', { status: 404 });
            }
            const hash = match[1] ?? '';
            const kind = match[2] ?? '';
            if (!HEX64.test(hash)) {
                return new Response('local-esm-cache: invalid hash', { status: 400 });
            }
            return serveArtifact(root, hash, kind);
        },
        error(err: Error): Response {
            console.error('[local-esm-cache] error:', err);
            return new Response('local-esm-cache: internal error', { status: 500 });
        },
    });

    console.log(
        `[local-esm-cache] listening on http://${server.hostname}:${server.port}\n` +
            `[local-esm-cache] content root: ${root}\n` +
            `[local-esm-cache] fallback synth: enabled (returns defaults when a file is missing)\n` +
            `[local-esm-cache] started at ${new Date(startedAt).toISOString()}`,
    );

    const shutdown = (): void => {
        console.log(`[local-esm-cache] stopping — served ${served} requests`);
        server.stop(true);
        process.exit(0);
    };
    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
}

function serveArtifact(root: string, hash: string, kind: string): Response {
    const diskPath = join(root, hash, kind);
    if (existsSync(diskPath)) {
        try {
            const buf = readFileSync(diskPath);
            const { size } = statSync(diskPath);
            return new Response(buf, {
                status: 200,
                headers: {
                    'content-type': contentTypeFor(kind),
                    'content-length': String(size),
                    'cache-control': 'no-store',
                },
            });
        } catch (err) {
            return new Response(`local-esm-cache: read error ${(err as Error).message}`, {
                status: 500,
            });
        }
    }
    // Fallback synth so partial setups still return 200s on the happy path.
    const body =
        kind === 'manifest-fields.json'
            ? JSON.stringify(defaultManifestFields(hash))
            : kind === 'meta.json'
              ? JSON.stringify(defaultMeta())
              : defaultBundle();
    return new Response(body, {
        status: 200,
        headers: {
            'content-type': contentTypeFor(kind),
            'cache-control': 'no-store',
            'x-local-esm-cache': 'synthesized',
        },
    });
}

// Export parseArgs for unit tests to exercise without spawning a server.
export { parseArgs, defaultManifestFields, defaultMeta, contentTypeFor, BUNDLE_ROUTE };

if (import.meta.main) {
    const args = parseArgs(process.argv.slice(2));
    serve(args);
}

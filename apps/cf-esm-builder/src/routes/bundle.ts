/**
 * GET /bundle/:hash[/<file>] — serves Hermes bundle bytes (and sibling
 * artifacts) from R2.
 *
 * Wire contract is locked in `plans/expo-browser-bundle-artifact.md` (TH0.3).
 * Summary:
 *
 *   - `GET /bundle/<hash>` is an alias for
 *     `GET /bundle/<hash>/index.android.bundle`. Body is the raw Hermes
 *     bytecode (first four bytes `0xc6 0x1f 0xbc 0x03`).
 *   - `GET /bundle/<hash>/<filename>` serves any sibling artifact written by
 *     the Container build script (`assetmap.json`, `sourcemap.json`,
 *     `manifest-fields.json`, `meta.json`, plus the per-platform Hermes
 *     bundles `index.android.bundle` / `index.ios.bundle`).
 *   - All responses use a content-addressed `ETag: "${hash}"` and an
 *     immutable `Cache-Control` because the URL itself changes when the
 *     content changes.
 *   - Conditional `If-None-Match` short-circuits to a 304 without touching
 *     R2 beyond the head check on the bundle file (we still verify it
 *     exists so a stale client can't pin a 304 to a 404 hash).
 *
 * Implements TH2.3 of `plans/expo-browser-e2e-task-queue.md`.
 */
import type { Env } from '../types';

// Default to the android bundle so existing single-platform call sites
// (the original scenario 12 cache check, the local-builder-shim's bare
// `/bundle/<hash>/` URL, etc.) keep working. iOS callers must specify
// `index.ios.bundle` explicitly — Expo Go does this via the manifest's
// launchAsset.url.
const DEFAULT_FILE = 'index.android.bundle';

const ALLOWED_FILES = new Set<string>([
    'index.android.bundle',
    'index.ios.bundle',
    'assetmap.json',
    'sourcemap.json',
    'manifest-fields.json',
    'meta.json',
]);

function contentTypeFor(file: string): string {
    if (file.endsWith('.json')) return 'application/json';
    return 'application/javascript';
}

interface BundleMeta {
    hermesVersion?: string;
}

async function readMeta(env: Env, hash: string): Promise<BundleMeta | null> {
    const obj = await env.BUNDLES.get(`bundle/${hash}/meta.json`);
    if (!obj) return null;
    try {
        const parsed = (await obj.json()) as BundleMeta;
        return parsed;
    } catch {
        return null;
    }
}

export async function handleBundle(request: Request, env: Env): Promise<Response> {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
        return new Response('Method Not Allowed', {
            status: 405,
            headers: { Allow: 'GET, HEAD' },
        });
    }

    const url = new URL(request.url);
    // /bundle/<hash>            -> ['', 'bundle', '<hash>']
    // /bundle/<hash>/<file>     -> ['', 'bundle', '<hash>', '<file>']
    const parts = url.pathname.split('/').filter((p) => p.length > 0);
    if (parts.length < 2 || parts[0] !== 'bundle') {
        return new Response('Not Found', { status: 404 });
    }

    const hash = parts[1];
    if (!hash) {
        return new Response('Not Found', { status: 404 });
    }

    const file = parts.length >= 3 ? parts.slice(2).join('/') : DEFAULT_FILE;
    if (!ALLOWED_FILES.has(file)) {
        return new Response('Not Found', { status: 404 });
    }

    const etag = `"${hash}"`;
    const ifNoneMatch = request.headers.get('If-None-Match');

    // The R2 head check is required even on a conditional request so a
    // client cannot keep a 304 alive for a hash whose underlying object has
    // been deleted (or never written).
    const head = await env.BUNDLES.head(`bundle/${hash}/${file}`);
    if (!head) {
        return new Response('Not Found', { status: 404 });
    }

    const meta = await readMeta(env, hash);
    const headers = new Headers({
        'Content-Type': contentTypeFor(file),
        'Cache-Control': 'public, max-age=31536000, immutable',
        ETag: etag,
    });
    if (meta?.hermesVersion) {
        headers.set('X-Hermes-Version', meta.hermesVersion);
    }

    if (ifNoneMatch && ifNoneMatch === etag) {
        return new Response(null, { status: 304, headers });
    }

    const obj = await env.BUNDLES.get(`bundle/${hash}/${file}`);
    if (!obj) {
        // Race: object disappeared between head and get.
        return new Response('Not Found', { status: 404 });
    }

    if (request.method === 'HEAD') {
        return new Response(null, { status: 200, headers });
    }

    return new Response(obj.body, { status: 200, headers });
}

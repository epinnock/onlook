/**
 * POST /build — uploads a project source tar and returns a cache-hit or
 * enqueues a Container build session. Implemented in TH2.1.
 *
 * Protocol source of truth: `plans/expo-browser-builder-protocol.md`
 * (TH0.2 §`POST /build`).
 */
import type { BuildResponse, Env } from '../types';
import { sha256OfTar } from '../lib/hash';

const MAX_BODY_BYTES = 100 * 1024 * 1024; // 100 MB hard cap (Worker request limit)

const ALLOWED_CONTENT_TYPES = new Set<string>([
    'application/x-tar',
    'application/gzip',
]);

function jsonError(message: string, status: number): Response {
    return new Response(JSON.stringify({ error: message }), {
        status,
        headers: { 'Content-Type': 'application/json' },
    });
}

function jsonResponse(body: BuildResponse, status = 200): Response {
    return new Response(JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json' },
    });
}

function parseContentType(header: string | null): string | null {
    if (!header) return null;
    const semi = header.indexOf(';');
    return (semi === -1 ? header : header.slice(0, semi)).trim().toLowerCase();
}

export async function handleBuild(request: Request, env: Env): Promise<Response> {
    try {
        const contentType = parseContentType(request.headers.get('content-type'));
        if (!contentType || !ALLOWED_CONTENT_TYPES.has(contentType)) {
            return jsonError('unsupported content-type', 400);
        }

        const projectId = request.headers.get('x-project-id');
        if (!projectId) {
            return jsonError('missing X-Project-Id', 400);
        }
        const branchId = request.headers.get('x-branch-id');
        if (!branchId) {
            return jsonError('missing X-Branch-Id', 400);
        }

        // Fast-path size check via Content-Length, if the client provided one.
        const contentLengthHeader = request.headers.get('content-length');
        if (contentLengthHeader) {
            const declared = Number(contentLengthHeader);
            if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
                return jsonError('body too large', 413);
            }
        }

        const buffer = await request.arrayBuffer();
        if (buffer.byteLength > MAX_BODY_BYTES) {
            return jsonError('body too large', 413);
        }

        const sourceHash = await sha256OfTar(buffer);

        // Cache check: if the bundle's meta.json already exists in R2, this is
        // a zero-cost hit and we can skip the Container entirely.
        if (env.BUNDLES) {
            const meta = await env.BUNDLES.head(`bundle/${sourceHash}/meta.json`);
            if (meta) {
                return jsonResponse({
                    buildId: sourceHash,
                    sourceHash,
                    cached: true,
                });
            }
        }

        // Cache miss: dispatch into the BuildSession DO. The DO is keyed by
        // sourceHash so concurrent POSTs of the same source coalesce onto a
        // single in-flight build.
        if (!env.BUILD_SESSION) {
            return jsonError('build session binding unavailable', 500);
        }

        const doId = env.BUILD_SESSION.idFromName(sourceHash);
        const stub = env.BUILD_SESSION.get(doId);

        // Forward the original request to the DO. The DO owns the source bytes
        // for the lifetime of the build and is responsible for kicking the
        // Container, writing R2, and returning the BuildResponse JSON.
        const forwardUrl = new URL(request.url);
        forwardUrl.pathname = '/start';
        forwardUrl.searchParams.set('sourceHash', sourceHash);
        forwardUrl.searchParams.set('projectId', projectId);
        forwardUrl.searchParams.set('branchId', branchId);

        const forwarded = new Request(forwardUrl.toString(), {
            method: 'POST',
            headers: {
                'Content-Type': contentType,
                'X-Project-Id': projectId,
                'X-Branch-Id': branchId,
                'X-Source-Hash': sourceHash,
            },
            body: buffer,
        });

        return await stub.fetch(forwarded);
    } catch (err) {
        const message = err instanceof Error ? err.message : 'bad request';
        return jsonError(message, 400);
    }
}

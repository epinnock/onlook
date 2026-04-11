#!/usr/bin/env bun
/**
 * local-relay-shim-node.ts — Node http-based relay shim for the Onlook
 * Phase H/Q manifest endpoint. Used as a drop-in replacement for
 * local-relay-shim.ts when iOS Expo Go's NSURLSession asserts on Bun's
 * header case normalization (Bun rewrites `cache-control` → `Cache-Control`
 * and reorders headers; node:http preserves case and order exactly).
 *
 * Diagnosis (2026-04-09): with Bun.serve, the manifest response had
 *   Cache-Control: private, max-age=0
 *   Content-Type: multipart/mixed; ...
 * (PascalCase) and Expo Go's URL session delegate asserted (EXC_BREAKPOINT
 * SIGTRAP). Real `expo start` sends:
 *   cache-control: private, max-age=0
 *   content-type: multipart/mixed; ...
 * (lowercase) and Expo Go loads cleanly. The case difference is the
 * smoking gun.
 *
 * This script imports `node:http` (Bun supports it) and uses
 * `res.writeHead(...)` which preserves header case verbatim. Everything
 * else (manifest patching, multipart serialization, bundle serving)
 * mirrors local-relay-shim.ts.
 */

import { readFile, stat } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';
import { createServer, request as httpRequest, type IncomingMessage, type ServerResponse } from 'node:http';
import { buildManifest, type ManifestFields } from '../apps/cf-expo-relay/src/manifest-builder';

// PROXY MODE: when EXPO_PROXY_URL is set, the manifest endpoint forwards
// ALL bytes from the upstream expo-cli dev server verbatim. Used as a
// debugging bisection — if the phone successfully loads a manifest
// proxied from real `expo start`, we know our HTTP response generation
// is the bug, not the URL or port. Set EXPO_PROXY_URL=http://192.168.0.14:8082
// to enable.
const EXPO_PROXY_URL = process.env.EXPO_PROXY_URL ?? '';

const PORT = parseInt(process.env.PORT ?? '8787', 10);
const STORE_DIR = process.env.STORE_DIR ?? '/tmp/cf-builds';
const LAN_IP = process.env.LAN_IP ?? '127.0.0.1';
const CF_ESM_CACHE_URL = process.env.CF_ESM_CACHE_URL ?? `http://${LAN_IP}:8788`;

function bundleHashToUuidV4Local(bundleHash: string): string {
    if (bundleHash.length < 32) return bundleHash;
    const h = bundleHash.toLowerCase().slice(0, 32);
    const v4 =
        h.slice(0, 12) +
        '4' +
        h.slice(13, 16) +
        (((parseInt(h[16] ?? '0', 16) & 0x3) | 0x8).toString(16)) +
        h.slice(17, 32);
    return `${v4.slice(0, 8)}-${v4.slice(8, 12)}-${v4.slice(12, 16)}-${v4.slice(16, 20)}-${v4.slice(20, 32)}`;
}

console.log(`[local-relay-shim-node] starting on port ${PORT}`);
console.log(`[local-relay-shim-node] store: ${STORE_DIR}`);
console.log(`[local-relay-shim-node] cache URL: ${CF_ESM_CACHE_URL}`);
console.log(`[local-relay-shim-node] LAN URL: http://${LAN_IP}:${PORT}`);

function logRequest(req: IncomingMessage) {
    const ua = req.headers['user-agent'] ?? '?';
    const expoPlatform = req.headers['expo-platform'] ?? '?';
    const expoRtv = req.headers['expo-runtime-version'] ?? '?';
    console.log(
        `[local-relay-shim-node] ${new Date().toISOString()} ${req.method} ${req.url} ` +
            `expo-platform=${expoPlatform} expo-rtv=${expoRtv} ` +
            `ua=${String(ua).slice(0, 100)}`,
    );
    if (req.url?.startsWith('/manifest/')) {
        console.log(`[local-relay-shim-node] ALL headers: ${JSON.stringify(req.headers)}`);
    }
}

function send(
    res: ServerResponse,
    status: number,
    headers: Array<[string, string]>,
    body: string | Buffer,
): void {
    // Per-header setHeader() preserves case verbatim. The
    // writeHead(status, headers) form normalizes well-known headers to
    // PascalCase (Cache-Control, Content-Type, etc.) which crashes
    // iOS Expo Go's NSURLSession response handler. Calling setHeader
    // for each header bypasses the normalization.
    res.statusCode = status;
    for (const [name, value] of headers) {
        res.setHeader(name, value);
    }
    res.end(body);
}

const server = createServer(async (req, res) => {
    logRequest(req);
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
    const path = url.pathname;
    const method = req.method ?? 'GET';

    try {
        if (path === '/health' && method === 'GET') {
            send(
                res,
                200,
                [['content-type', 'application/json']],
                JSON.stringify({ ok: true, version: '0.1.0-local-shim-node' }),
            );
            return;
        }

        const manifestMatch = path.match(/^\/manifest\/([a-f0-9]{64})$/);
        if (manifestMatch && method === 'GET') {
            const bundleHash = manifestMatch[1]!;

            // PROXY MODE: forward the upstream expo-cli response 1:1.
            // Used to bisect "is our shim's HTTP layer the bug, or is it
            // the URL/port itself". Returns the EXACT bytes from
            // ${EXPO_PROXY_URL}/ — including all headers in their
            // original case and order, and the multipart body verbatim.
            if (EXPO_PROXY_URL) {
                console.log(
                    `[local-relay-shim-node] PROXY MODE: forwarding to ${EXPO_PROXY_URL}/`,
                );
                await new Promise<void>((resolveProxy, rejectProxy) => {
                    const upstream = new URL(EXPO_PROXY_URL);
                    const upstreamReq = httpRequest(
                        {
                            host: upstream.hostname,
                            port: upstream.port || 80,
                            path: '/',
                            method: 'GET',
                            headers: {
                                ...req.headers,
                                host: `${upstream.hostname}:${upstream.port || 80}`,
                            },
                        },
                        (upstreamRes) => {
                            // Forward status code, headers (preserving the
                            // RAW header tuples expo-cli sent), and body.
                            const rawHeaders: Array<[string, string]> = [];
                            for (let i = 0; i < upstreamRes.rawHeaders.length; i += 2) {
                                rawHeaders.push([
                                    upstreamRes.rawHeaders[i]!,
                                    upstreamRes.rawHeaders[i + 1]!,
                                ]);
                            }
                            console.log(
                                `[local-relay-shim-node] proxy upstream returned ${upstreamRes.statusCode} with ${rawHeaders.length} headers`,
                            );
                            res.writeHead(upstreamRes.statusCode ?? 200, rawHeaders);
                            upstreamRes.pipe(res);
                            upstreamRes.on('end', () => resolveProxy());
                            upstreamRes.on('error', rejectProxy);
                        },
                    );
                    upstreamReq.on('error', (err) => {
                        console.error('[local-relay-shim-node] proxy upstream error:', err);
                        try {
                            send(
                                res,
                                502,
                                [['content-type', 'text/plain']],
                                `relay proxy error: ${err.message}`,
                            );
                        } catch {}
                        rejectProxy(err);
                    });
                    upstreamReq.end();
                }).catch((err) => {
                    console.error('[local-relay-shim-node] proxy promise error:', err);
                });
                return;
            }

            const fieldsPath = join(STORE_DIR, bundleHash, 'manifest-fields.json');
            const metaPath = join(STORE_DIR, bundleHash, 'meta.json');

            if (!existsSync(fieldsPath)) {
                send(
                    res,
                    404,
                    [['content-type', 'application/json']],
                    JSON.stringify({ error: `manifest-fields.json not found for ${bundleHash}` }),
                );
                return;
            }

            const fieldsRaw = await readFile(fieldsPath, 'utf8');
            const fields = JSON.parse(fieldsRaw) as ManifestFields;

            let builtAt = new Date().toISOString();
            if (existsSync(metaPath)) {
                try {
                    const meta = JSON.parse(await readFile(metaPath, 'utf8')) as { builtAt?: string };
                    if (typeof meta?.builtAt === 'string') builtAt = meta.builtAt;
                } catch {
                    /* fall through */
                }
            }

            const headerPlatform = req.headers['expo-platform'];
            let platform: 'ios' | 'android' = 'android';
            if (headerPlatform === 'ios') platform = 'ios';
            else if (headerPlatform === 'android') platform = 'android';
            else {
                const queryPlatform = url.searchParams.get('platform');
                if (queryPlatform === 'ios') platform = 'ios';
                else if (queryPlatform === 'android') platform = 'android';
            }

            const manifest = buildManifest({
                bundleHash,
                cfEsmCacheUrl: CF_ESM_CACHE_URL,
                fields,
                builtAt,
                platform,
            });

            // Patch manifest fields to match expo-cli's exact shape.
            const debuggerHost = `${LAN_IP}:${PORT}`;
            const slug = manifest.extra.expoClient.slug;
            const anonymousId = bundleHashToUuidV4Local(bundleHash);
            const scopeKey = `@anonymous/${slug}-${anonymousId}`;

            // launchAsset.url uses Metro's URL convention so Expo Go's
            // URL parser sees a familiar shape.
            const bundleQuery = new URLSearchParams({
                platform: 'ios',
                dev: 'false',
                hot: 'false',
                lazy: 'true',
                minify: 'true',
                'transform.engine': 'hermes',
                'transform.bytecode': '0',
                'transform.routerRoot': 'app',
                unstable_transformProfile: 'hermes-stable',
                hash: bundleHash,
            });
            const launchAssetUrl = `http://${debuggerHost}/index.ts.bundle?${bundleQuery.toString()}`;

            // Strip fields that expo-cli does NOT include in its
            // expoClient block. Each of these has been observed in our
            // manifest but absent from real expo start; any one could
            // trip Expo Go's strict parser:
            //   - icon: null (parser may expect string-or-absent)
            //   - runtimeVersion (duplicate of top-level — expo-cli
            //     only has it at the top of the manifest)
            //   - splash (not in expo-cli's app.json)
            const cleanedExpoClient: Record<string, unknown> = {};
            for (const [k, v] of Object.entries(manifest.extra.expoClient)) {
                if (k === 'icon' || k === 'runtimeVersion' || k === 'splash') continue;
                cleanedExpoClient[k] = v;
            }

            const patchedManifest = {
                ...manifest,
                launchAsset: {
                    ...manifest.launchAsset,
                    url: launchAssetUrl,
                },
                extra: {
                    eas: {},
                    expoClient: {
                        ...cleanedExpoClient,
                        _internal: {
                            isDebug: false,
                            projectRoot: '/private/tmp/onlook-fixture',
                            dynamicConfigPath: null,
                            staticConfigPath: '/private/tmp/onlook-fixture/app.json',
                            packageJsonPath: '/private/tmp/onlook-fixture/package.json',
                        },
                        hostUri: debuggerHost,
                    },
                    expoGo: {
                        debuggerHost,
                        developer: {
                            tool: 'expo-cli',
                            projectRoot: '/private/tmp/onlook-fixture',
                        },
                        packagerOpts: { dev: false },
                        mainModuleName: 'index.ts',
                    },
                    scopeKey,
                },
            };

            const boundary = 'formdata-' + bundleHash.slice(0, 16);
            const manifestJson = JSON.stringify(patchedManifest);
            const body =
                `--${boundary}\r\n` +
                `Content-Disposition: form-data; name="manifest"\r\n` +
                `Content-Type: application/json\r\n` +
                `\r\n` +
                `${manifestJson}\r\n` +
                `--${boundary}--\r\n`;

            // Headers in EXACTLY the order + case expo-cli sends them.
            // Node's http module preserves both — no normalization.
            send(
                res,
                200,
                [
                    ['expo-protocol-version', '0'],
                    ['expo-sfv-version', '0'],
                    ['cache-control', 'private, max-age=0'],
                    ['content-type', `multipart/mixed; boundary=${boundary}`],
                    ['Connection', 'keep-alive'],
                    ['Keep-Alive', 'timeout=5'],
                ],
                body,
            );
            return;
        }

        // Metro-style bundle URL
        const metroBundleMatch = path.match(/^\/[^\/]+\.bundle$/);
        if (metroBundleMatch && method === 'GET') {
            const queryHash = url.searchParams.get('hash');
            const queryPlatform = url.searchParams.get('platform');
            if (!queryHash || !/^[a-f0-9]{64}$/.test(queryHash)) {
                send(res, 400, [['content-type', 'text/plain']], 'relay: missing or invalid &hash=<sha256>');
                return;
            }
            const plat: 'ios' | 'android' = queryPlatform === 'android' ? 'android' : 'ios';
            const bundleJsPath = join(STORE_DIR, queryHash, `index.${plat}.bundle.js`);
            if (!existsSync(bundleJsPath)) {
                send(res, 404, [['content-type', 'text/plain']], `relay: no bundle for ${queryHash}/${plat}`);
                return;
            }
            const body = await readFile(bundleJsPath);
            console.log(
                `[local-relay-shim-node] served Metro JS bundle ${queryHash.slice(0, 12)}/${plat} (${body.length} bytes)`,
            );
            send(
                res,
                200,
                [
                    ['X-Content-Type-Options', 'nosniff'],
                    ['Surrogate-Control', 'no-store'],
                    ['Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate'],
                    ['Pragma', 'no-cache'],
                    ['Expires', '0'],
                    ['Content-Type', 'application/javascript; charset=UTF-8'],
                    ['Connection', 'keep-alive'],
                    ['Keep-Alive', 'timeout=5'],
                ],
                body,
            );
            return;
        }

        // No-op endpoints to absorb Expo Go dev-mode side connections.
        if (
            method === 'GET' &&
            (path === '/logs' || path === '/status' || path === '/symbolicate')
        ) {
            send(res, 200, [['content-type', 'application/json']], '{}');
            return;
        }
        if (method === 'POST' && (path === '/logs' || path === '/symbolicate')) {
            send(res, 200, [['content-type', 'application/json']], '{}');
            return;
        }

        send(res, 404, [['content-type', 'text/plain']], 'not found');
    } catch (err) {
        console.error('[local-relay-shim-node]', err);
        send(res, 500, [['content-type', 'application/json']], JSON.stringify({ error: String(err) }));
    }
});

server.listen(PORT, '0.0.0.0', () => {
    console.log(`[local-relay-shim-node] listening on 0.0.0.0:${PORT}`);
});

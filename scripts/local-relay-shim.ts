#!/usr/bin/env bun
/**
 * local-relay-shim.ts — local replacement for cf-expo-relay Worker.
 *
 * Reads the bundle artifact set from the local-builder-shim's store
 * (/tmp/cf-builds/<hash>/manifest-fields.json + meta.json) and constructs
 * a real Expo Updates v2 manifest using the SAME buildManifest() function
 * the cf-expo-relay Worker uses (apps/cf-expo-relay/src/manifest-builder.ts).
 *
 * Endpoints (mirrors plans/expo-browser-relay-manifest.md):
 *   GET /health                     → { ok, version }
 *   GET /manifest/:bundleHash       → Expo Updates v2 manifest JSON
 *
 * The manifest's launchAsset.url points at the local-builder-shim
 * (CF_ESM_CACHE_URL env var, defaults to http://${LAN_IP}:8788).
 *
 * Run via:
 *   bun scripts/local-relay-shim.ts
 *   PORT=8787 LAN_IP=192.168.0.14 CF_ESM_CACHE_URL=http://192.168.0.14:8788 \
 *     bun scripts/local-relay-shim.ts
 */

import { readFile } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';
import { buildManifest, type ManifestFields } from '../apps/cf-expo-relay/src/manifest-builder';

const PORT = parseInt(process.env.PORT ?? '8787', 10);
const STORE_DIR = process.env.STORE_DIR ?? '/tmp/cf-builds';
const LAN_IP = process.env.LAN_IP ?? '127.0.0.1';
const CF_ESM_CACHE_URL = process.env.CF_ESM_CACHE_URL ?? `http://${LAN_IP}:8788`;
const VERSION = '0.1.0-local-shim';

/**
 * Convert a 64-char hex SHA256 hash into a deterministic UUID v4 string.
 * Used to derive a stable scopeKey suffix for the manifest's
 * `extra.scopeKey` field. Mirrors the helper in cf-expo-relay's
 * manifest-builder.ts.
 */
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

console.log(`[local-relay-shim] starting on port ${PORT}`);
console.log(`[local-relay-shim] store: ${STORE_DIR}`);
console.log(`[local-relay-shim] cache URL: ${CF_ESM_CACHE_URL}`);
console.log(`[local-relay-shim] LAN URL: http://${LAN_IP}:${PORT}`);

Bun.serve({
    port: PORT,
    hostname: '0.0.0.0',
    async fetch(req: Request) {
        const url = new URL(req.url);
        const path = url.pathname;
        const method = req.method;

        // Log every request so we can prove the phone reached us, and what
        // it asked for. Expo Go SDK 50+ sends User-Agent + Expo-Platform.
        const ua = req.headers.get('user-agent') ?? '?';
        const expoPlatform = req.headers.get('expo-platform') ?? '?';
        const expoSdk = req.headers.get('expo-sdk-version') ?? '?';
        const expoRtv = req.headers.get('expo-runtime-version') ?? '?';
        const remote = req.headers.get('x-forwarded-for') ?? '(local)';
        console.log(
            `[local-relay-shim] ${new Date().toISOString()} ${method} ${path} ` +
            `expo-platform=${expoPlatform} expo-sdk=${expoSdk} expo-rtv=${expoRtv} ` +
            `from=${remote} ua=${ua.slice(0, 100)}`,
        );

        // Dump ALL request headers for /manifest/* requests so we can spot
        // code-signing, channel, expect-signature, etc. that Expo Go SDK 54
        // sends but we don't normally surface.
        if (path.startsWith('/manifest/')) {
            const allHeaders: Record<string, string> = {};
            req.headers.forEach((value, key) => {
                allHeaders[key] = value;
            });
            console.log(`[local-relay-shim] ALL headers: ${JSON.stringify(allHeaders)}`);
        }

        // CORS — Expo Go iOS client preflights manifest fetches
        const cors = {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, OPTIONS',
            'Access-Control-Allow-Headers': '*',
        };
        if (method === 'OPTIONS') return new Response(null, { headers: cors });

        try {
            if (path === '/health' && method === 'GET') {
                return Response.json({ ok: true, version: VERSION }, { headers: cors });
            }

            // Match /manifest/<hash> with optional query params so callers
            // can cache-bust iOS NSURLSession by appending ?v=<anything>.
            const manifestMatch = path.match(/^\/manifest\/([a-f0-9]{64})$/);
            if (manifestMatch && method === 'GET') {
                const bundleHash = manifestMatch[1];
                const fieldsPath = join(STORE_DIR, bundleHash, 'manifest-fields.json');
                const metaPath = join(STORE_DIR, bundleHash, 'meta.json');

                if (!existsSync(fieldsPath)) {
                    return Response.json(
                        { error: `manifest-fields.json not found for bundleHash ${bundleHash}` },
                        { status: 404, headers: cors },
                    );
                }

                const fieldsRaw = await readFile(fieldsPath, 'utf8');
                let fields: ManifestFields;
                try {
                    fields = JSON.parse(fieldsRaw) as ManifestFields;
                } catch {
                    return Response.json({ error: 'malformed manifest-fields.json' }, { status: 502, headers: cors });
                }

                let builtAt = new Date().toISOString();
                if (existsSync(metaPath)) {
                    try {
                        const meta = JSON.parse(await readFile(metaPath, 'utf8'));
                        if (typeof meta?.builtAt === 'string') builtAt = meta.builtAt;
                    } catch {
                        // best-effort — fall back to now
                    }
                }

                // Resolve target platform from the Expo Go header (or
                // ?platform= for curl-friendly testing). Mirrors the
                // canonical resolvePlatform() in apps/cf-expo-relay.
                const headerPlatform = req.headers.get('expo-platform');
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

                // Patch the manifest to match real `expo start`'s shape
                // BYTE-FOR-BYTE. Verified against the actual response from
                // `npx expo start --lan` running locally on this Mac on
                // 2026-04-09 — see /tmp/expo-cli-manifest.txt for the
                // captured baseline.
                const debuggerHost = `${LAN_IP}:${PORT}`;
                const slug = manifest.extra.expoClient.slug;

                // Build the launchAsset URL in Metro's exact convention so
                // Expo Go's URL parser doesn't assert on an unfamiliar
                // shape: /<mainModule>.bundle?platform=...&dev=false&...
                // Includes &hash=<bundleHash> so the relay's bundle route
                // can look up the right artifact dir.
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
                // Real expo-cli generates a per-anonymous-id scopeKey of
                // the form `@anonymous/<slug>-<uuid>`. We generate ours
                // deterministically from the bundle hash so the same
                // build always produces the same scopeKey.
                const anonymousId = bundleHashToUuidV4Local(bundleHash);
                const scopeKey = `@anonymous/${slug}-${anonymousId}`;

                const patchedManifest = {
                    ...manifest,
                    launchAsset: {
                        ...manifest.launchAsset,
                        url: launchAssetUrl,
                    },
                    extra: {
                        eas: {},
                        expoClient: {
                            ...manifest.extra.expoClient,
                            // _internal is REQUIRED — expo-cli always sets it
                            // and Expo Go's manifest parser may assert on it.
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
                            // mainModuleName INCLUDES the .ts extension —
                            // expo-cli sends `index.ts`, NOT `index`. This
                            // is one of the byte-diffs against our previous
                            // attempt.
                            mainModuleName: 'index.ts',
                        },
                        scopeKey,
                    },
                };

                // Match `expo start`'s exact multipart format. Critical
                // differences from the previous version of this shim:
                //   1. NO CORS headers — expo-cli doesn't send any
                //      Access-Control-Allow-* headers and iOS NSURLSession's
                //      response handler may assert on their presence in a
                //      dev-mode manifest response.
                //   2. Boundary format `formdata-<16 hex>` (not
                //      OnlookExpoManifestBoundary...)
                //   3. Connection: keep-alive + Keep-Alive: timeout=5
                //   4. Lowercase header names where expo-cli uses lowercase
                //      (content-type, cache-control, expo-*).
                //   5. Per-part: Content-Disposition + Content-Type (both)
                const boundary = 'formdata-' + bundleHash.slice(0, 16);
                const manifestJson = JSON.stringify(patchedManifest);
                const body =
                    `--${boundary}\r\n` +
                    `Content-Disposition: form-data; name="manifest"\r\n` +
                    `Content-Type: application/json\r\n` +
                    `\r\n` +
                    `${manifestJson}\r\n` +
                    `--${boundary}--\r\n`;

                return new Response(body, {
                    headers: {
                        // Headers in the EXACT order + case expo-cli uses,
                        // no CORS, with Connection: keep-alive.
                        'expo-protocol-version': '0',
                        'expo-sfv-version': '0',
                        'cache-control': 'private, max-age=0',
                        'content-type': `multipart/mixed; boundary=${boundary}`,
                        'Connection': 'keep-alive',
                        'Keep-Alive': 'timeout=5',
                    },
                });
            }

            // Metro-style bundle URL: /<entry>.bundle?platform=...&hash=...
            // Expo Go fetches this from the manifest's launchAsset.url.
            // We serve the pre-Hermes Metro JS output (.bundle.js) NOT
            // the Hermes bytecode — real `expo start` does the same thing
            // even when the URL has transform.bytecode=1, because Expo
            // Go's iOS dev runtime evaluates JS via JSC, not Hermes.
            const metroBundleMatch = path.match(/^\/[^\/]+\.bundle$/);
            if (metroBundleMatch && method === 'GET') {
                const queryHash = url.searchParams.get('hash');
                const queryPlatform = url.searchParams.get('platform');
                if (!queryHash || !/^[a-f0-9]{64}$/.test(queryHash)) {
                    return new Response('relay: missing or invalid &hash=<sha256>', {
                        status: 400,
                    });
                }
                const plat: 'ios' | 'android' =
                    queryPlatform === 'android' ? 'android' : 'ios';
                const bundleJsPath = join(
                    STORE_DIR,
                    queryHash,
                    `index.${plat}.bundle.js`,
                );
                if (!existsSync(bundleJsPath)) {
                    return new Response(`relay: no bundle for hash=${queryHash} plat=${plat}`, {
                        status: 404,
                    });
                }
                const body = await readFile(bundleJsPath);
                console.log(
                    `[local-relay-shim] served Metro JS bundle ${queryHash.slice(0, 12)}/${plat} (${body.length} bytes)`,
                );
                return new Response(body, {
                    headers: {
                        // Headers match real expo-cli's bundle response
                        'X-Content-Type-Options': 'nosniff',
                        'Surrogate-Control': 'no-store',
                        'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
                        'Pragma': 'no-cache',
                        'Expires': '0',
                        'Content-Type': 'application/javascript; charset=UTF-8',
                        'Connection': 'keep-alive',
                        'Keep-Alive': 'timeout=5',
                    },
                });
            }

            // No-op endpoints Expo Go's dev-mode side connections might
            // hit. Return 200 with an empty body so the iOS HTTP client
            // doesn't retry / hang waiting for one of them. None of these
            // are real Metro features — Onlook just needs the responses
            // to NOT be 404s so Expo Go's URL session delegate doesn't
            // assert in its retry loop.
            if (
                method === 'GET' &&
                (path === '/logs' || path === '/status' || path === '/symbolicate')
            ) {
                return new Response('{}', {
                    headers: { ...cors, 'Content-Type': 'application/json' },
                });
            }
            if (method === 'POST' && (path === '/logs' || path === '/symbolicate')) {
                return new Response('{}', {
                    headers: { ...cors, 'Content-Type': 'application/json' },
                });
            }

            return new Response('not found', { status: 404, headers: cors });
        } catch (err) {
            console.error('[local-relay-shim]', err);
            return Response.json({ error: String(err) }, { status: 500, headers: cors });
        }
    },
});

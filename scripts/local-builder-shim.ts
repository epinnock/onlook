#!/usr/bin/env bun
/**
 * local-builder-shim.ts — local replacement for cf-esm-builder Worker.
 *
 * Wraps `docker run -i cf-esm-builder:dev < tar` in a tiny Bun HTTP server
 * so the editor can hit a real http://LAN_IP:8788/build endpoint without
 * needing a Cloudflare account with Containers enabled.
 *
 * Endpoints (mirrors plans/expo-browser-builder-protocol.md):
 *   GET  /health               → { ok, version, container }
 *   POST /build                → { buildId, sourceHash, cached }
 *   GET  /build/:buildId       → { state, bundleHash, builtAt, sizeBytes }
 *   GET  /bundle/:hash         → application/javascript (Hermes bytecode)
 *   GET  /bundle/:hash/:file   → application/json or application/javascript
 *
 * Uses /tmp/cf-builds/<bundleHash>/ as the artifact store. Hashes the source
 * tar via SHA256 of the tar bytes (NOT the canonical sha256OfTar from
 * cf-esm-builder/src/lib/hash.ts — that requires importing from the worker
 * package which has CF Worker types. The local shim uses raw byte hash
 * which is good enough for content-addressable caching).
 *
 * Run via:
 *   bun scripts/local-builder-shim.ts
 *   PORT=8788 LAN_IP=192.168.0.14 bun scripts/local-builder-shim.ts
 */

import { mkdir, readFile, writeFile, stat, readdir } from 'fs/promises';
import { existsSync } from 'fs';
import { spawn } from 'child_process';
import { join } from 'path';
import { createHash } from 'crypto';

const PORT = parseInt(process.env.PORT ?? '8788', 10);
const STORE_DIR = process.env.STORE_DIR ?? '/tmp/cf-builds';
const IMAGE = process.env.IMAGE ?? 'cf-esm-builder:dev';
const VERSION = '0.1.0-local-shim';
// (Removed 2026-04-08) Previously a DEMO_FIXTURE_TAR env var let this shim
// swap the incoming source tar for a known-good Hermes-compatible fixture
// from disk, working around the v1/v2 Phase R fixture's react-native-web
// incompatibility with Container Metro+Hermes. The seeded fixture is now
// dual-runtime (scripts/seed-expo-fixture.ts v3) so the shim no longer
// needs the swap — the editor's source tar IS Hermes-compatible. If a
// future divergence reappears, fix the seed script, not this shim.

// In-memory build state — persists across requests but not across restarts
type BuildState = 'pending' | 'building' | 'ready' | 'failed';
interface BuildRecord {
    buildId: string;
    sourceHash: string;
    state: BuildState;
    bundleHash?: string;
    builtAt?: string;
    sizeBytes?: number;
    error?: string;
}
const builds = new Map<string, BuildRecord>();

await mkdir(STORE_DIR, { recursive: true });

console.log(`[local-builder-shim] starting on port ${PORT}`);
console.log(`[local-builder-shim] store: ${STORE_DIR}`);
console.log(`[local-builder-shim] image: ${IMAGE}`);
console.log(`[local-builder-shim] LAN URL: http://${process.env.LAN_IP ?? '127.0.0.1'}:${PORT}`);

Bun.serve({
    port: PORT,
    hostname: '0.0.0.0',
    async fetch(req: Request) {
        const url = new URL(req.url);
        const path = url.pathname;
        const method = req.method;

        // Log every request so we can prove the phone reached us, and what
        // it asked for. Expo Go fetches the bundle URL with Hermes-specific
        // Accept and X-Hermes headers.
        const ua = req.headers.get('user-agent') ?? '?';
        const expoPlatform = req.headers.get('expo-platform') ?? '?';
        const accept = req.headers.get('accept') ?? '?';
        console.log(
            `[local-builder-shim] ${new Date().toISOString()} ${method} ${path} ` +
            `expo-platform=${expoPlatform} accept=${accept.slice(0, 60)} ua=${ua.slice(0, 80)}`,
        );

        // CORS — phone may make preflight; editor definitely does
        const cors = {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
            'Access-Control-Allow-Headers': '*',
        };
        if (method === 'OPTIONS') return new Response(null, { headers: cors });

        try {
            if (path === '/health' && method === 'GET') {
                return Response.json({ ok: true, version: VERSION, container: 'ready' }, { headers: cors });
            }

            if (path === '/build' && method === 'POST') {
                const tarBytes = new Uint8Array(await req.arrayBuffer());
                if (tarBytes.length === 0) {
                    return Response.json({ error: 'empty body' }, { status: 400, headers: cors });
                }
                if (tarBytes.length > 100 * 1024 * 1024) {
                    return Response.json({ error: 'body too large (>100MB)' }, { status: 413, headers: cors });
                }
                const projectId = req.headers.get('X-Project-Id') ?? 'unknown';
                const branchId = req.headers.get('X-Branch-Id') ?? 'unknown';

                // Hash the tar bytes for content addressing
                const sourceHash = createHash('sha256').update(tarBytes).digest('hex');
                const bundleHash = sourceHash;
                const buildId = sourceHash;

                // Cache check — if we already built this exact source, return immediately
                const metaPath = join(STORE_DIR, bundleHash, 'meta.json');
                if (existsSync(metaPath)) {
                    builds.set(buildId, {
                        buildId,
                        sourceHash,
                        state: 'ready',
                        bundleHash,
                        builtAt: JSON.parse(await readFile(metaPath, 'utf8')).builtAt,
                        sizeBytes: (await stat(join(STORE_DIR, bundleHash, 'index.android.bundle'))).size,
                    });
                    return Response.json({ buildId, sourceHash, cached: true }, { headers: cors });
                }

                // Mark pending + kick off the docker run async
                builds.set(buildId, { buildId, sourceHash, state: 'pending' });
                runBuild(buildId, tarBytes, projectId, branchId).catch((err) => {
                    console.error('[local-builder-shim] build failed:', err);
                    const rec = builds.get(buildId);
                    if (rec) {
                        rec.state = 'failed';
                        rec.error = String(err);
                    }
                });
                return Response.json({ buildId, sourceHash, cached: false }, { headers: cors });
            }

            const buildMatch = path.match(/^\/build\/([a-f0-9]{64})$/);
            if (buildMatch && method === 'GET') {
                const rec = builds.get(buildMatch[1]);
                if (!rec) return Response.json({ error: 'unknown buildId' }, { status: 404, headers: cors });
                return Response.json(rec, { headers: cors });
            }

            const bundleMatch = path.match(/^\/bundle\/([a-f0-9]{64})(?:\/(.+))?$/);
            if (bundleMatch && method === 'GET') {
                const hash = bundleMatch[1];
                const filename = bundleMatch[2] ?? 'index.android.bundle';
                const filePath = join(STORE_DIR, hash, filename);
                if (!existsSync(filePath)) {
                    return new Response('not found', { status: 404, headers: cors });
                }
                const body = await readFile(filePath);
                const contentType = filename.endsWith('.json')
                    ? 'application/json'
                    : 'application/javascript';
                return new Response(body, {
                    headers: {
                        ...cors,
                        'Content-Type': contentType,
                        'Cache-Control': 'public, max-age=31536000, immutable',
                        'ETag': `"${hash}"`,
                    },
                });
            }

            return new Response('not found', { status: 404, headers: cors });
        } catch (err) {
            console.error('[local-builder-shim]', err);
            return Response.json({ error: String(err) }, { status: 500, headers: cors });
        }
    },
});

async function runBuild(
    buildId: string,
    tarBytes: Uint8Array,
    projectId: string,
    branchId: string,
): Promise<void> {
    const rec = builds.get(buildId);
    if (!rec) return;
    rec.state = 'building';
    console.log(`[local-builder-shim] build ${buildId.slice(0, 12)}... starting (project=${projectId} branch=${branchId})`);

    const outDir = join(STORE_DIR, buildId);
    await mkdir(outDir, { recursive: true });

    // Spawn `docker run -i -v <outDir>:/output cf-esm-builder:dev` and pipe the tar to stdin
    // Save the input tar for debugging failed builds
    await writeFile(join(outDir, 'input.tar'), tarBytes);

    const proc = spawn('docker', ['run', '--rm', '-i', '-v', `${outDir}:/output`, IMAGE]);

    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString(); });
    proc.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });

    // Pipe the tar
    proc.stdin.write(tarBytes);
    proc.stdin.end();

    const exitCode: number = await new Promise((resolve) => {
        proc.on('close', resolve);
    });

    if (exitCode !== 0) {
        rec.state = 'failed';
        rec.error = `docker exited ${exitCode}: ${stderr.slice(-500)}`;
        console.error(`[local-builder-shim] build ${buildId.slice(0, 12)}... FAILED: ${rec.error}`);
        return;
    }

    // Patch PLACEHOLDER_HASH in meta.json + manifest-fields.json with the real hash
    for (const filename of ['meta.json', 'manifest-fields.json']) {
        const filePath = join(outDir, filename);
        if (existsSync(filePath)) {
            const content = await readFile(filePath, 'utf8');
            await writeFile(filePath, content.replaceAll('PLACEHOLDER_HASH', buildId));
        }
    }

    // Container build.sh now produces BOTH index.android.bundle and
    // index.ios.bundle (one for each Expo Go target). Verify both exist —
    // a missing bundle is a Container regression and the editor's QR scan
    // would 404 on whichever platform is missing.
    const androidPath = join(outDir, 'index.android.bundle');
    const iosPath = join(outDir, 'index.ios.bundle');
    if (!existsSync(androidPath)) {
        rec.state = 'failed';
        rec.error = 'Container did not produce index.android.bundle';
        console.error(`[local-builder-shim] build ${buildId.slice(0, 12)}... FAILED: ${rec.error}`);
        return;
    }
    if (!existsSync(iosPath)) {
        rec.state = 'failed';
        rec.error = 'Container did not produce index.ios.bundle';
        console.error(`[local-builder-shim] build ${buildId.slice(0, 12)}... FAILED: ${rec.error}`);
        return;
    }

    const androidSize = (await stat(androidPath)).size;
    const iosSize = (await stat(iosPath)).size;
    const sizeBytes = androidSize + iosSize;
    const builtAt = new Date().toISOString();

    rec.state = 'ready';
    rec.bundleHash = buildId;
    rec.sizeBytes = sizeBytes;
    rec.builtAt = builtAt;
    console.log(
        `[local-builder-shim] build ${buildId.slice(0, 12)}... READY (android=${androidSize}B + ios=${iosSize}B = ${sizeBytes}B, ${builtAt})`,
    );
}

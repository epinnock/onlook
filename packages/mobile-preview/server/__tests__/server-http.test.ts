/**
 * HTTP-layer integration test for the mobile-preview server.
 *
 * Spawns the real `server/index.ts` in a subprocess on isolated ports
 * and exercises the actual endpoints Expo Go hits when scanning a QR
 * code: GET /status → /manifest/:hash → /:hash.ts.bundle. Confirms the
 * routing, headers, and response bodies match what the iPhone runtime
 * expects. Sibling to `expo-go-end-to-end.test.ts`, which exercises
 * the same chain at the function level — this version covers the
 * Bun.serve routing layer that the function tests deliberately bypass.
 *
 * Why both: a regression in `server/index.ts`'s path-matching regex,
 * a missing CORS header on /status, or a content-type mismatch on the
 * manifest body would all let the function tests pass while breaking
 * the actual Expo Go fetch. The HTTP test catches that class of bug.
 *
 * If `runtime/bundle.js` is missing, the spawn aborts with a clear
 * pointer to `bun run build:runtime`. If the chosen test port is
 * occupied (e.g. another mobile-preview server running on the dev
 * box), the test fails with a port-conflict diagnostic so the operator
 * can pick a different slot.
 */
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';

import { RUNTIME_BUNDLE_PATH } from '../bundle-store';
import { manifestBoundary } from '../manifest';

// Slot 13 from CLAUDE.md's port allocation table. CI runs on a clean
// host with no other mobile-preview server, so this is safe; the slot
// is high enough to avoid colliding with developer-machine slot 0
// (8787) or any of the ones the parallel-execution methodology would
// hand out for active worktrees (slots 0-12 fill first by convention).
const TEST_HTTP_PORT = 8800;
const TEST_WS_PORT = 8900;
const TEST_LAN_IP = '127.0.0.1';
const SERVER_ENTRY = join(import.meta.dir, '..', 'index.ts');

let server: ReturnType<typeof Bun.spawn> | null = null;
let storeDir: string;

async function waitForServerReady(maxMs = 5000): Promise<void> {
    const start = Date.now();
    let lastErr: unknown = null;
    while (Date.now() - start < maxMs) {
        try {
            const res = await fetch(`http://${TEST_LAN_IP}:${TEST_HTTP_PORT}/health`);
            if (res.ok) return;
            lastErr = new Error(`/health returned ${res.status}`);
        } catch (e) {
            lastErr = e;
        }
        await new Promise((r) => setTimeout(r, 50));
    }
    throw new Error(
        `server did not become ready on http://${TEST_LAN_IP}:${TEST_HTTP_PORT} within ${maxMs}ms — last error: ${lastErr instanceof Error ? lastErr.message : String(lastErr)}`,
    );
}

beforeAll(async () => {
    if (!existsSync(RUNTIME_BUNDLE_PATH)) {
        // Caller-friendly: tests below will skip rather than fail-hard.
        return;
    }

    storeDir = mkdtempSync(join(tmpdir(), 'onlook-http-it-'));

    server = Bun.spawn(['bun', 'run', SERVER_ENTRY], {
        env: {
            ...process.env,
            MOBILE_PREVIEW_PORT: String(TEST_HTTP_PORT),
            MOBILE_PREVIEW_WS_PORT: String(TEST_WS_PORT),
            MOBILE_PREVIEW_LAN_IP: TEST_LAN_IP,
            MOBILE_PREVIEW_STORE: storeDir,
        },
        stdout: 'pipe',
        stderr: 'pipe',
    });

    try {
        await waitForServerReady();
    } catch (err) {
        // Capture child output so a port-conflict / startup error
        // surfaces in the test log instead of vanishing.
        let stderrText = '';
        try {
            stderrText = await new Response(server.stderr).text();
        } catch {
            /* ignore */
        }
        server.kill();
        server = null;
        throw new Error(
            `${err instanceof Error ? err.message : String(err)}\n\nServer stderr:\n${stderrText.slice(-2000)}`,
        );
    }
});

afterAll(() => {
    if (server) {
        server.kill();
        server = null;
    }
    try {
        rmSync(storeDir, { recursive: true, force: true });
    } catch {
        /* ignore */
    }
});

describe('server-http: real HTTP fetch through Bun.serve routing', () => {
    if (!existsSync(RUNTIME_BUNDLE_PATH)) {
        test.skip('runtime/bundle.js missing — run `bun run build:runtime`', () => {
            /* skipped */
        });
        return;
    }

    test('GET /health responds 200 with version JSON', async () => {
        const res = await fetch(`http://${TEST_LAN_IP}:${TEST_HTTP_PORT}/health`);
        expect(res.status).toBe(200);
        const body = (await res.json()) as { ok: boolean; version: string };
        expect(body.ok).toBe(true);
        expect(typeof body.version).toBe('string');
    });

    test('GET /status returns manifestUrl with the staged runtime hash', async () => {
        const res = await fetch(`http://${TEST_LAN_IP}:${TEST_HTTP_PORT}/status`);
        expect(res.status).toBe(200);
        // CORS so the editor (running on a different port) can poll us.
        expect(res.headers.get('access-control-allow-origin')).toBe('*');

        const body = (await res.json()) as {
            runtimeHash: string | null;
            manifestUrl: string | null;
            clients: number;
        };
        expect(body.runtimeHash).toMatch(/^[0-9a-f]{64}$/);
        expect(typeof body.clients).toBe('number');
        // The exact line-44-of-the-article shape: `exp://<host>:<port>/manifest/<hash>`.
        expect(body.manifestUrl).toBe(
            `exp://${TEST_LAN_IP}:${TEST_HTTP_PORT}/manifest/${body.runtimeHash}`,
        );
    });

    test('GET /manifest/:hash returns multipart/mixed with the expected boundary + JSON', async () => {
        const statusRes = await fetch(
            `http://${TEST_LAN_IP}:${TEST_HTTP_PORT}/status`,
        );
        const { runtimeHash } = (await statusRes.json()) as {
            runtimeHash: string;
        };

        const manifestRes = await fetch(
            `http://${TEST_LAN_IP}:${TEST_HTTP_PORT}/manifest/${runtimeHash}`,
            { headers: { 'expo-platform': 'ios' } },
        );
        expect(manifestRes.status).toBe(200);
        const contentType = manifestRes.headers.get('content-type') ?? '';
        const boundary = manifestBoundary(runtimeHash);
        expect(contentType).toContain('multipart/mixed');
        expect(contentType).toContain(`boundary=${boundary}`);
        // Expo Go is picky about these headers — assert their presence
        // so a header-rename regression in the response builder is
        // caught here rather than at runtime on the phone.
        expect(manifestRes.headers.get('expo-protocol-version')).toBe('0');
        expect(manifestRes.headers.get('expo-sfv-version')).toBe('0');

        const body = await manifestRes.text();
        expect(body.startsWith(`--${boundary}\r\n`)).toBe(true);
        expect(body.endsWith(`\r\n--${boundary}--\r\n`)).toBe(true);

        const jsonStart = body.indexOf('{');
        const jsonEnd = body.lastIndexOf('}');
        const manifest = JSON.parse(body.slice(jsonStart, jsonEnd + 1)) as {
            launchAsset: { url: string; contentType: string };
        };
        expect(manifest.launchAsset.contentType).toBe('application/javascript');
        // The launch URL is what Expo Go fetches next; assert it
        // points back at this same server's bundle endpoint with the
        // same hash. Mismatch here = phone fetches the wrong bytes.
        expect(manifest.launchAsset.url).toContain(
            `http://${TEST_LAN_IP}:${TEST_HTTP_PORT}/${runtimeHash}.ts.bundle`,
        );
        expect(manifest.launchAsset.url).toContain('platform=ios');
    });

    test('GET /:hash.ts.bundle returns the runtime bytes with JS content-type', async () => {
        const statusRes = await fetch(
            `http://${TEST_LAN_IP}:${TEST_HTTP_PORT}/status`,
        );
        const { runtimeHash } = (await statusRes.json()) as {
            runtimeHash: string;
        };

        const bundleRes = await fetch(
            `http://${TEST_LAN_IP}:${TEST_HTTP_PORT}/${runtimeHash}.ts.bundle?platform=ios`,
        );
        expect(bundleRes.status).toBe(200);
        expect(bundleRes.headers.get('content-type') ?? '').toContain(
            'application/javascript',
        );

        const bytes = new Uint8Array(await bundleRes.arrayBuffer());
        // The shipped bundle has a stable size + the IIFE wrap from
        // build-runtime.regression.test.ts. Sanity-check both: bytes
        // start with `(` (IIFE wrap) and the body is non-trivial.
        expect(bytes.length).toBeGreaterThan(50_000);
        expect(String.fromCharCode(bytes[0]!)).toBe('(');
    });

    test('GET /unknown-path returns 404 (regex matchers are tight)', async () => {
        const res = await fetch(
            `http://${TEST_LAN_IP}:${TEST_HTTP_PORT}/manifest/not-a-real-hash`,
        );
        // The /manifest matcher requires exactly 64 hex chars, so
        // "not-a-real-hash" must NOT match; falls through to 404.
        expect(res.status).toBe(404);
    });
});

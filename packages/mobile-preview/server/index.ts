/**
 * Mobile Preview Server
 *
 * Combined HTTP relay (Expo manifest + bundle serving) and WebSocket
 * hot-reload server. Replaces the separate Python relay + Bun hot-server.
 *
 * Run: bun run packages/mobile-preview/server/index.ts
 *
 * Endpoints:
 *   GET  /manifest/:hash      — Expo Updates v2 manifest
 *   GET  /:hash.ts.bundle     — JS bundle serving
 *   GET  /health              — Health check
 *   WS   /                    — WebSocket for hot reload
 *   POST /push                — Push eval message to all connected phones
 *   GET  /status              — JSON status (connected clients, runtime hash)
 */

import {
  STORE_DIR,
  currentRuntimeHash,
  ensureRuntimeStaged,
  readBundle,
} from './bundle-store';
import { handleManifestRequest } from './manifest';
import {
  HTTP_PORT,
  LAN_IP,
  WS_PORT,
  broadcastMessage,
  decodeSocketMessage,
  lastPushedMessage,
  toBundlePlatform,
  withCors,
  wsClients,
} from './relay';
import { createHttpStatusResponse, createWsStatusResponse } from './status';

// --- WebSocket hot-reload server ---

const wsServer = Bun.serve({
  port: WS_PORT,
  fetch(req, server) {
    if (server.upgrade(req)) return undefined;
    const url = new URL(req.url);

    if (url.pathname === '/push' && req.method === 'POST') {
      return req.text().then((body) => {
        return Response.json({ ok: true, clients: broadcastMessage(body) });
      });
    }

    if (url.pathname === '/status') {
      return createWsStatusResponse({
        clients: wsClients.size,
        runtimeHash: currentRuntimeHash,
        lanIp: LAN_IP,
        httpPort: HTTP_PORT,
        wsPort: WS_PORT,
      });
    }

    return new Response(`mobile-preview ws (${wsClients.size} clients)`);
  },
  websocket: {
    idleTimeout: 120,
    open(ws) {
      wsClients.add(ws);
      console.log(`[mobile-preview] WS client connected (${wsClients.size} total)`);
      if (lastPushedMessage) {
        try {
          ws.send(lastPushedMessage);
        } catch (_) {}
      }
    },
    close(ws) {
      wsClients.delete(ws);
      console.log(`[mobile-preview] WS client disconnected (${wsClients.size} total)`);
    },
    message(_ws, msg) {
      const str = decodeSocketMessage(msg);
      for (const c of wsClients) {
        try {
          c.send(str);
        } catch (_) {}
      }
    },
  },
});

// --- HTTP relay server (manifest + bundle serving) ---

const httpServer = Bun.serve({
  port: HTTP_PORT,
  fetch(req) {
    const url = new URL(req.url);
    const path = url.pathname;

    // CORS preflight
    if (req.method === 'OPTIONS') {
      return withCors(new Response(null, { status: 204 }));
    }

    // Health check
    if (path === '/health') {
      return withCors(Response.json({ ok: true, version: '0.1.0' }));
    }

    // Status (polled by ExpoQrButton in the Onlook editor)
    if (path === '/status') {
      return withCors(
        createHttpStatusResponse({
          runtimeHash: currentRuntimeHash,
          clients: wsClients.size,
          lanIp: LAN_IP,
          httpPort: HTTP_PORT,
        }),
      );
    }

    if (path === '/push' && req.method === 'POST') {
      return req.text().then((body) =>
        withCors(
          Response.json({
            ok: true,
            clients: broadcastMessage(body),
          }),
        ),
      );
    }

    // Manifest
    const manifestMatch = path.match(/^\/manifest\/([a-f0-9]{64})$/);
    if (manifestMatch) {
      return handleManifestRequest(req, manifestMatch[1], {
        storeDir: STORE_DIR,
        lanIp: LAN_IP,
        httpPort: HTTP_PORT,
      });
    }

    // Bundle
    const bundleMatch = path.match(/^\/([a-f0-9]{64})(?:\.ts)?\.bundle$/);
    if (bundleMatch) {
      const hash = bundleMatch[1];
      const platform = toBundlePlatform(url.searchParams.get('platform'));
      const body = readBundle(hash, platform, STORE_DIR);
      if (!body) {
        return new Response(`bundle not found: ${hash}`, { status: 404 });
      }
      return new Response(body as unknown as BodyInit, {
        headers: new Headers([
          ['content-type', 'application/javascript; charset=UTF-8'],
          ['cache-control', 'no-store, no-cache, must-revalidate'],
        ]),
      });
    }

    // Absorb Expo Go dev-mode noise
    if (['/logs', '/symbolicate'].includes(path)) {
      return Response.json({});
    }

    return new Response('not found', { status: 404 });
  },
});

// --- Startup ---

try {
  const hash = ensureRuntimeStaged();
  const manifestUrl = `exp://${LAN_IP}:${HTTP_PORT}/manifest/${hash}`;

  console.log(`[mobile-preview] HTTP relay on http://0.0.0.0:${HTTP_PORT}`);
  console.log(`[mobile-preview] WebSocket on ws://0.0.0.0:${WS_PORT}`);
  console.log(`[mobile-preview] LAN IP: ${LAN_IP}`);
  console.log(`[mobile-preview] Runtime hash: ${hash.slice(0, 12)}...`);
  console.log(`[mobile-preview] Manifest URL: ${manifestUrl}`);
  console.log(
    `[mobile-preview] Push updates: curl -X POST http://localhost:${WS_PORT}/push -d '{"type":"eval","code":"..."}'`,
  );
  console.log(`[mobile-preview] Ready.`);
} catch (e) {
  console.error(`[mobile-preview] ${(e as Error).message}`);
  process.exit(1);
}

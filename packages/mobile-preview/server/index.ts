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

import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

const HTTP_PORT = parseInt(process.env.MOBILE_PREVIEW_PORT || '8787');
const WS_PORT = parseInt(process.env.MOBILE_PREVIEW_WS_PORT || '8788');
const STORE_DIR = process.env.MOBILE_PREVIEW_STORE || '/tmp/cf-builds';
const LAN_IP = process.env.MOBILE_PREVIEW_LAN_IP || getLocalIP();

// --- Utilities ---

function getLocalIP(): string {
  const os = require('os');
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name] || []) {
      if (iface.family === 'IPv4' && !iface.internal) {
        return iface.address;
      }
    }
  }
  return '127.0.0.1';
}

function bundleHashToUUID(hash: string): string {
  if (hash.length < 32) return hash;
  const h = hash.toLowerCase().slice(0, 32);
  const variant = ((parseInt(h[16], 16) & 0x3) | 0x8).toString(16);
  const v4 = h.slice(0, 12) + '4' + h.slice(13, 16) + variant + h.slice(17, 32);
  return `${v4.slice(0, 8)}-${v4.slice(8, 12)}-${v4.slice(12, 16)}-${v4.slice(16, 20)}-${v4.slice(20, 32)}`;
}

function buildManifest(bundleHash: string, fields: any, platform: string): string {
  const debuggerHost = `${LAN_IP}:${HTTP_PORT}`;
  const slug = fields?.extra?.expoClient?.slug || 'onlook-preview';
  const uuid = bundleHashToUUID(bundleHash);
  const scopeKey = `@anonymous/${slug}-${uuid}`;

  const bundleQuery = `platform=${platform}&dev=false&hot=false&lazy=true&minify=true&transform.engine=hermes&transform.bytecode=1&transform.routerRoot=app&unstable_transformProfile=hermes-stable`;
  const launchAssetUrl = `http://${debuggerHost}/${bundleHash}.ts.bundle?${bundleQuery}`;

  const manifest = {
    id: uuid,
    createdAt: new Date().toISOString(),
    runtimeVersion: fields?.runtimeVersion || '1.0.0',
    launchAsset: {
      key: fields?.launchAsset?.key || `bundle-${bundleHash}`,
      contentType: 'application/javascript',
      url: launchAssetUrl,
    },
    assets: [],
    metadata: {},
    extra: {
      eas: {},
      expoClient: {
        ...(fields?.extra?.expoClient || {}),
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
        developer: { tool: 'expo-cli', projectRoot: '/private/tmp/onlook-fixture' },
        packagerOpts: { dev: false },
        mainModuleName: 'index.ts',
      },
      scopeKey,
    },
  };

  const json = JSON.stringify(manifest);
  const boundary = `formdata-${bundleHash.slice(0, 16)}`;
  return `--${boundary}\r\ncontent-disposition: form-data; name="manifest"\r\ncontent-type: application/json\r\n\r\n${json}\r\n--${boundary}--\r\n`;
}

// --- Runtime bundle management ---

let currentRuntimeHash: string | null = null;
let lastPushedMessage: string | null = null;

function ensureRuntimeStaged(): string {
  if (currentRuntimeHash) return currentRuntimeHash;

  const runtimePath = join(import.meta.dir, '..', 'runtime', 'bundle.js');
  if (!existsSync(runtimePath)) {
    throw new Error(
      `Runtime bundle not found at ${runtimePath}. Run: bun run packages/mobile-preview/server/build-runtime.ts`
    );
  }

  const bundle = readFileSync(runtimePath);
  const crypto = require('crypto');
  const hash = crypto.createHash('sha256').update(bundle).digest('hex');

  const dir = join(STORE_DIR, hash);
  require('fs').mkdirSync(dir, { recursive: true });
  require('fs').writeFileSync(join(dir, 'index.ios.bundle.js'), bundle);
  require('fs').writeFileSync(join(dir, 'index.android.bundle.js'), bundle);

  const fields = {
    runtimeVersion: '1.0.0',
    launchAsset: { key: `bundle-${hash}`, contentType: 'application/javascript' },
    assets: [], metadata: {},
    extra: {
      expoClient: {
        name: 'onlook-preview', slug: 'onlook-preview', version: '1.0.0',
        sdkVersion: '54.0.0', platforms: ['ios', 'android'],
        newArchEnabled: true,
      },
      scopeKey: '@onlook/mobile-preview',
      eas: { projectId: null },
    },
  };
  require('fs').writeFileSync(join(dir, 'manifest-fields.json'), JSON.stringify(fields, null, 2));
  require('fs').writeFileSync(join(dir, 'meta.json'), JSON.stringify({
    sourceHash: hash, bundleHash: hash,
    builtAt: new Date().toISOString(),
    sizeBytes: bundle.length,
  }, null, 2));

  currentRuntimeHash = hash;
  return hash;
}

// --- WebSocket hot-reload server ---

const wsClients = new Set<any>();

function broadcastMessage(message: string): number {
  lastPushedMessage = message;
  for (const ws of wsClients) {
    try { ws.send(message); } catch (_) {}
  }
  return wsClients.size;
}

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
      return Response.json({
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
        try { ws.send(lastPushedMessage); } catch (_) {}
      }
    },
    close(ws) {
      wsClients.delete(ws);
      console.log(`[mobile-preview] WS client disconnected (${wsClients.size} total)`);
    },
    message(ws, msg) {
      const str = typeof msg === 'string' ? msg : new TextDecoder().decode(msg as ArrayBuffer);
      for (const c of wsClients) {
        try { c.send(str); } catch (_) {}
      }
    },
  },
});

// --- HTTP relay server (manifest + bundle serving) ---

function withCors(res: Response): Response {
  res.headers.set('Access-Control-Allow-Origin', '*');
  res.headers.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.headers.set('Access-Control-Allow-Headers', '*');
  return res;
}

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
      return withCors(Response.json({
        runtimeHash: currentRuntimeHash,
        clients: wsClients.size,
        manifestUrl: currentRuntimeHash
          ? `exp://${LAN_IP}:${HTTP_PORT}/manifest/${currentRuntimeHash}`
          : null,
      }));
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
      const bundleHash = manifestMatch[1];
      const fieldsPath = join(STORE_DIR, bundleHash, 'manifest-fields.json');
      if (!existsSync(fieldsPath)) {
        return Response.json({ error: 'not found' }, { status: 404 });
      }
      const fields = JSON.parse(readFileSync(fieldsPath, 'utf-8'));
      const platform = req.headers.get('expo-platform') || 'ios';
      const boundary = `formdata-${bundleHash.slice(0, 16)}`;
      const body = buildManifest(bundleHash, fields, platform);

      return new Response(body, {
        status: 200,
        headers: new Headers([
          ['expo-protocol-version', '0'],
          ['expo-sfv-version', '0'],
          ['cache-control', 'private, max-age=0'],
          ['content-type', `multipart/mixed; boundary=${boundary}`],
          ['connection', 'keep-alive'],
        ]),
      });
    }

    // Bundle
    const bundleMatch = path.match(/^\/([a-f0-9]{64})(?:\.ts)?\.bundle$/);
    if (bundleMatch) {
      const hash = bundleMatch[1];
      const platform = url.searchParams.get('platform') === 'android' ? 'android' : 'ios';
      const bundlePath = join(STORE_DIR, hash, `index.${platform}.bundle.js`);
      if (!existsSync(bundlePath)) {
        return new Response(`bundle not found: ${hash}`, { status: 404 });
      }
      const body = readFileSync(bundlePath);
      return new Response(body, {
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
  console.log(`[mobile-preview] Push updates: curl -X POST http://localhost:${WS_PORT}/push -d '{"type":"eval","code":"..."}'`);
  console.log(`[mobile-preview] Ready.`);
} catch (e: any) {
  console.error(`[mobile-preview] ${e.message}`);
  process.exit(1);
}

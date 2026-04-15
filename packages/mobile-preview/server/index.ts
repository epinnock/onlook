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

import os from 'os';

import { buildManifestMultipart } from './manifest';
import { createRelayState, decodeRelayMessage } from './relay';
import { createRuntimeStore } from './runtime-store';
import type { PreviewPlatform } from './runtime-store';
import { buildHttpStatus, buildManifestUrl, buildWsStatus } from './status';

interface MobilePreviewLogger {
  error(message: string): void;
  log(message: string): void;
}

export interface MobilePreviewServerOptions {
  httpPort: number;
  lanIp: string;
  logger: MobilePreviewLogger;
  now?: () => Date;
  runtimeBundlePath?: string;
  storeDir: string;
  wsPort: number;
}

function getLocalIP(): string {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name] ?? []) {
      if (iface.family === 'IPv4' && !iface.internal) {
        return iface.address;
      }
    }
  }

  return '127.0.0.1';
}

function getNumberEnv(name: string, fallback: number): number {
  const value = process.env[name];
  if (!value) return fallback;

  const parsed = parseInt(value, 10);
  return Number.isNaN(parsed) ? fallback : parsed;
}

function createDefaultLogger(): MobilePreviewLogger {
  return {
    log(message: string) {
      console.log(message);
    },
    error(message: string) {
      console.error(message);
    },
  };
}

function withCors(response: Response): Response {
  response.headers.set('Access-Control-Allow-Origin', '*');
  response.headers.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  response.headers.set('Access-Control-Allow-Headers', '*');
  return response;
}

export function createMobilePreviewServer(
  options: Partial<MobilePreviewServerOptions> = {},
) {
  const httpPort = options.httpPort ?? getNumberEnv('MOBILE_PREVIEW_PORT', 8787);
  const wsPort = options.wsPort ?? getNumberEnv('MOBILE_PREVIEW_WS_PORT', 8788);
  const storeDir = options.storeDir ?? process.env.MOBILE_PREVIEW_STORE ?? '/tmp/cf-builds';
  const lanIp = options.lanIp ?? process.env.MOBILE_PREVIEW_LAN_IP ?? getLocalIP();
  const logger = options.logger ?? createDefaultLogger();
  const runtimeStore = createRuntimeStore({
    storeDir,
    runtimeBundlePath: options.runtimeBundlePath,
    now: options.now,
  });
  const relay = createRelayState(logger.log);

  const getRuntimeSdkVersion = () => {
    const runtimeHash = runtimeStore.getCurrentRuntimeHash();
    if (!runtimeHash) {
      return null;
    }

    return runtimeStore.getRuntimeBuildMetadata(runtimeHash)?.sdkVersion ?? null;
  };

  const createHttpFetchHandler = () => {
    return async (request: Request): Promise<Response> => {
      const url = new URL(request.url);
      const path = url.pathname;

      if (request.method === 'OPTIONS') {
        return withCors(new Response(null, { status: 204 }));
      }

      if (path === '/health') {
        return withCors(Response.json({ ok: true, version: '0.1.0' }));
      }

      if (path === '/status') {
        return withCors(
          Response.json(
            buildHttpStatus({
              runtimeHash: runtimeStore.getCurrentRuntimeHash(),
              runtimeSdkVersion: getRuntimeSdkVersion(),
              clientCount: relay.getClientCount(),
              lanIp,
              httpPort,
            }),
          ),
        );
      }

      if (path === '/push' && request.method === 'POST') {
        const body = await request.text();
        return withCors(
          Response.json({
            ok: true,
            clients: relay.broadcastMessage(body),
          }),
        );
      }

      const manifestMatch = path.match(/^\/manifest\/([a-f0-9]{64})$/);
      if (manifestMatch) {
        const bundleHash = manifestMatch[1];
        const fields = runtimeStore.getManifestFields(bundleHash);
        if (!fields) {
          return Response.json({ error: 'not found' }, { status: 404 });
        }

        const { body, boundary } = buildManifestMultipart({
          bundleHash,
          fields,
          platform: request.headers.get('expo-platform') ?? 'ios',
          lanIp,
          httpPort,
        });

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

      const bundleMatch = path.match(/^\/([a-f0-9]{64})(?:\.ts)?\.bundle$/);
      if (bundleMatch) {
        const bundleHash = bundleMatch[1];
        const platform: PreviewPlatform =
          url.searchParams.get('platform') === 'android' ? 'android' : 'ios';
        const bundle = runtimeStore.getBundle(bundleHash, platform);
        if (!bundle) {
          return new Response(`bundle not found: ${bundleHash}`, { status: 404 });
        }

        return new Response(bundle, {
          headers: new Headers([
            ['content-type', 'application/javascript; charset=UTF-8'],
            ['cache-control', 'no-store, no-cache, must-revalidate'],
          ]),
        });
      }

      if (path === '/logs' || path === '/symbolicate') {
        return Response.json({});
      }

      return new Response('not found', { status: 404 });
    };
  };

  const createWsFetchHandler = () => {
    return async (request: Request, server: Bun.Server): Promise<Response | undefined> => {
      if (server.upgrade(request)) return undefined;

      const url = new URL(request.url);
      if (url.pathname === '/push' && request.method === 'POST') {
        const body = await request.text();
        return Response.json({ ok: true, clients: relay.broadcastMessage(body) });
      }

      if (url.pathname === '/status') {
        return Response.json(
          buildWsStatus({
            runtimeHash: runtimeStore.getCurrentRuntimeHash(),
            runtimeSdkVersion: getRuntimeSdkVersion(),
            clientCount: relay.getClientCount(),
            lanIp,
            httpPort,
            wsPort,
          }),
        );
      }

      return new Response(`mobile-preview ws (${relay.getClientCount()} clients)`);
    };
  };

  const websocket = {
    idleTimeout: 120,
    open(client: { send(message: string): void }) {
      relay.addClient(client);
    },
    close(client: { send(message: string): void }) {
      relay.removeClient(client);
    },
    message(_: unknown, message: string | ArrayBuffer | Uint8Array) {
      relay.relayMessage(decodeRelayMessage(message));
    },
  };

  const start = () => {
    const wsServer = Bun.serve({
      port: wsPort,
      fetch: createWsFetchHandler(),
      websocket,
    });
    const httpServer = Bun.serve({
      port: httpPort,
      fetch: createHttpFetchHandler(),
    });

    return { httpServer, wsServer };
  };

  return {
    httpPort,
    wsPort,
    storeDir,
    lanIp,
    relay,
    runtimeStore,
    createHttpFetchHandler,
    createWsFetchHandler,
    start,
  };
}

if (import.meta.main) {
  const server = createMobilePreviewServer();

  try {
    const hash = server.runtimeStore.ensureRuntimeStaged();
    const manifestUrl =
      buildManifestUrl({
        runtimeHash: hash,
        lanIp: server.lanIp,
        httpPort: server.httpPort,
      }) ?? '';

    server.start();

    console.log(`[mobile-preview] HTTP relay on http://0.0.0.0:${server.httpPort}`);
    console.log(`[mobile-preview] WebSocket on ws://0.0.0.0:${server.wsPort}`);
    console.log(`[mobile-preview] LAN IP: ${server.lanIp}`);
    console.log(`[mobile-preview] Runtime hash: ${hash.slice(0, 12)}...`);
    console.log(`[mobile-preview] Manifest URL: ${manifestUrl}`);
    console.log(
      `[mobile-preview] Push updates: curl -X POST http://localhost:${server.wsPort}/push -d '{"type":"eval","code":"..."}'`,
    );
    console.log('[mobile-preview] Ready.');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[mobile-preview] ${message}`);
    process.exit(1);
  }
}

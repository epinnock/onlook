import { networkInterfaces } from 'node:os';

import {
  STORE_DIR,
  currentRuntimeHash,
  readBundle,
  readManifestFields,
} from './bundle-store';
import type { MobilePreviewBundlePlatform, MobilePreviewManifestFields } from './routes';

export const HTTP_PORT = parseInt(process.env.MOBILE_PREVIEW_PORT || '8787');
export const WS_PORT = parseInt(process.env.MOBILE_PREVIEW_WS_PORT || '8788');
export const LAN_IP = process.env.MOBILE_PREVIEW_LAN_IP || getLocalIP();

export interface BuildManifestOptions {
  readonly lanIp?: string;
  readonly httpPort?: number;
  readonly now?: () => Date;
}

export interface MobilePreviewSocket {
  send(message: string): unknown;
}

export interface RelayRequestOptions {
  readonly httpPort?: number;
  readonly lanIp?: string;
  readonly storeDir?: string;
  readonly getRuntimeHash?: () => string | null;
  readonly getClientCount?: () => number;
  readonly broadcast?: (message: string) => number;
}

export interface WebSocketRelayOptions extends RelayRequestOptions {
  readonly wsPort?: number;
}

export const wsClients = new Set<MobilePreviewSocket>();
export let lastPushedMessage: string | null = null;

export function getLocalIP(): string {
  const interfaces = networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name] || []) {
      if (iface.family === 'IPv4' && !iface.internal) {
        return iface.address;
      }
    }
  }
  return '127.0.0.1';
}

export function bundleHashToUUID(hash: string): string {
  if (hash.length < 32) return hash;
  const h = hash.toLowerCase().slice(0, 32);
  const variant = ((parseInt(h[16], 16) & 0x3) | 0x8).toString(16);
  const v4 = h.slice(0, 12) + '4' + h.slice(13, 16) + variant + h.slice(17, 32);
  return `${v4.slice(0, 8)}-${v4.slice(8, 12)}-${v4.slice(12, 16)}-${v4.slice(16, 20)}-${v4.slice(20, 32)}`;
}

export function buildManifest(
  bundleHash: string,
  fields: MobilePreviewManifestFields | null | undefined,
  platform: string,
  options: BuildManifestOptions = {},
): string {
  const httpPort = options.httpPort ?? HTTP_PORT;
  const lanIp = options.lanIp ?? LAN_IP;
  const debuggerHost = `${lanIp}:${httpPort}`;
  const slug = fields?.extra?.expoClient?.slug || 'onlook-preview';
  const uuid = bundleHashToUUID(bundleHash);
  const scopeKey = `@anonymous/${slug}-${uuid}`;

  const bundleQuery = `platform=${platform}&dev=false&hot=false&lazy=true&minify=true&transform.engine=hermes&transform.bytecode=1&transform.routerRoot=app&unstable_transformProfile=hermes-stable`;
  const launchAssetUrl = `http://${debuggerHost}/${bundleHash}.ts.bundle?${bundleQuery}`;

  const manifest = {
    id: uuid,
    createdAt: (options.now ?? (() => new Date()))().toISOString(),
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

export function withCors(res: Response): Response {
  res.headers.set('Access-Control-Allow-Origin', '*');
  res.headers.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.headers.set('Access-Control-Allow-Headers', '*');
  return res;
}

export function broadcastMessage(message: string): number {
  lastPushedMessage = message;
  for (const ws of wsClients) {
    try {
      ws.send(message);
    } catch (_) {}
  }
  return wsClients.size;
}

export function decodeSocketMessage(msg: string | ArrayBuffer | Uint8Array): string {
  return typeof msg === 'string' ? msg : new TextDecoder().decode(msg);
}

export function toBundlePlatform(platform: string | null): MobilePreviewBundlePlatform {
  return platform === 'android' ? 'android' : 'ios';
}

export function handleHttpRelayRequest(
  req: Request,
  options: RelayRequestOptions = {},
): Response | Promise<Response> {
  const httpPort = options.httpPort ?? HTTP_PORT;
  const lanIp = options.lanIp ?? LAN_IP;
  const storeDir = options.storeDir ?? STORE_DIR;
  const getRuntimeHash = options.getRuntimeHash ?? (() => currentRuntimeHash);
  const getClientCount = options.getClientCount ?? (() => wsClients.size);
  const broadcast = options.broadcast ?? broadcastMessage;

  const url = new URL(req.url);
  const path = url.pathname;

  if (req.method === 'OPTIONS') {
    return withCors(new Response(null, { status: 204 }));
  }

  if (path === '/health') {
    return withCors(Response.json({ ok: true, version: '0.1.0' }));
  }

  if (path === '/status') {
    const runtimeHash = getRuntimeHash();
    return withCors(
      Response.json({
        runtimeHash,
        clients: getClientCount(),
        manifestUrl: runtimeHash ? `exp://${lanIp}:${httpPort}/manifest/${runtimeHash}` : null,
      }),
    );
  }

  if (path === '/push' && req.method === 'POST') {
    return req.text().then((body) =>
      withCors(
        Response.json({
          ok: true,
          clients: broadcast(body),
        }),
      ),
    );
  }

  const manifestMatch = path.match(/^\/manifest\/([a-f0-9]{64})$/);
  if (manifestMatch) {
    const bundleHash = manifestMatch[1];
    const fields = readManifestFields(bundleHash, storeDir);
    if (!fields) {
      return Response.json({ error: 'not found' }, { status: 404 });
    }
    const platform = req.headers.get('expo-platform') || 'ios';
    const boundary = `formdata-${bundleHash.slice(0, 16)}`;
    const body = buildManifest(bundleHash, fields, platform, { httpPort, lanIp });

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
    const hash = bundleMatch[1];
    const platform = toBundlePlatform(url.searchParams.get('platform'));
    const body = readBundle(hash, platform, storeDir);
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

  if (['/logs', '/symbolicate'].includes(path)) {
    return Response.json({});
  }

  return new Response('not found', { status: 404 });
}

export function createHttpRelayServer(options: RelayRequestOptions = {}) {
  const httpPort = options.httpPort ?? HTTP_PORT;
  return Bun.serve({
    port: httpPort,
    fetch(req) {
      return handleHttpRelayRequest(req, { ...options, httpPort });
    },
  });
}

export function createWebSocketRelayServer(options: WebSocketRelayOptions = {}) {
  const wsPort = options.wsPort ?? WS_PORT;
  const httpPort = options.httpPort ?? HTTP_PORT;
  const lanIp = options.lanIp ?? LAN_IP;
  const getRuntimeHash = options.getRuntimeHash ?? (() => currentRuntimeHash);
  const getClientCount = options.getClientCount ?? (() => wsClients.size);
  const broadcast = options.broadcast ?? broadcastMessage;

  return Bun.serve({
    port: wsPort,
    fetch(req, server) {
      if (server.upgrade(req)) return undefined;
      const url = new URL(req.url);

      if (url.pathname === '/push' && req.method === 'POST') {
        return req.text().then((body) => {
          return Response.json({ ok: true, clients: broadcast(body) });
        });
      }

      if (url.pathname === '/status') {
        return Response.json({
          clients: getClientCount(),
          runtimeHash: getRuntimeHash(),
          lanIp,
          httpPort,
          wsPort,
        });
      }

      return new Response(`mobile-preview ws (${getClientCount()} clients)`);
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
}

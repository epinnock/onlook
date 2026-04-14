interface StatusOptions {
  clientCount: number;
  httpPort: number;
  lanIp: string;
  runtimeHash: string | null;
}

interface WsStatusOptions extends StatusOptions {
  wsPort: number;
}

export function buildManifestUrl(options: Omit<StatusOptions, 'clientCount'>): string | null {
  if (!options.runtimeHash) return null;

  return `exp://${options.lanIp}:${options.httpPort}/manifest/${options.runtimeHash}`;
}

export function buildHttpStatus(options: StatusOptions) {
  return {
    runtimeHash: options.runtimeHash,
    clients: options.clientCount,
    manifestUrl: buildManifestUrl(options),
  };
}

export function buildWsStatus(options: WsStatusOptions) {
  return {
    clients: options.clientCount,
    runtimeHash: options.runtimeHash,
    lanIp: options.lanIp,
    httpPort: options.httpPort,
    wsPort: options.wsPort,
  };
}

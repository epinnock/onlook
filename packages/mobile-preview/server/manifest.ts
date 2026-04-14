export interface LaunchAssetFields extends Record<string, unknown> {
  key?: string;
}

export interface ExpoClientManifestFields extends Record<string, unknown> {
  slug?: string;
}

export interface ManifestExtraFields extends Record<string, unknown> {
  expoClient?: ExpoClientManifestFields;
}

export interface ManifestFields extends Record<string, unknown> {
  runtimeVersion?: string;
  launchAsset?: LaunchAssetFields;
  extra?: ManifestExtraFields;
}

interface BuildManifestOptions {
  bundleHash: string;
  fields: ManifestFields;
  httpPort: number;
  lanIp: string;
  platform: string;
}

export function bundleHashToUUID(hash: string): string {
  if (hash.length < 32) return hash;

  const normalizedHash = hash.toLowerCase().slice(0, 32);
  const variant = ((parseInt(normalizedHash[16], 16) & 0x3) | 0x8).toString(16);
  const v4 =
    normalizedHash.slice(0, 12) +
    '4' +
    normalizedHash.slice(13, 16) +
    variant +
    normalizedHash.slice(17, 32);

  return `${v4.slice(0, 8)}-${v4.slice(8, 12)}-${v4.slice(12, 16)}-${v4.slice(16, 20)}-${v4.slice(20, 32)}`;
}

export function buildManifestMultipart(options: BuildManifestOptions): {
  body: string;
  boundary: string;
} {
  const debuggerHost = `${options.lanIp}:${options.httpPort}`;
  const expoClient = options.fields.extra?.expoClient ?? {};
  const slug = typeof expoClient.slug === 'string' ? expoClient.slug : 'onlook-preview';
  const uuid = bundleHashToUUID(options.bundleHash);
  const scopeKey = `@anonymous/${slug}-${uuid}`;
  const boundary = `formdata-${options.bundleHash.slice(0, 16)}`;
  const bundleQuery = `platform=${options.platform}&dev=false&hot=false&lazy=true&minify=true&transform.engine=hermes&transform.bytecode=1&transform.routerRoot=app&unstable_transformProfile=hermes-stable`;

  const manifest = {
    id: uuid,
    createdAt: new Date().toISOString(),
    runtimeVersion:
      typeof options.fields.runtimeVersion === 'string' ? options.fields.runtimeVersion : '1.0.0',
    launchAsset: {
      key:
        typeof options.fields.launchAsset?.key === 'string'
          ? options.fields.launchAsset.key
          : `bundle-${options.bundleHash}`,
      contentType: 'application/javascript',
      url: `http://${debuggerHost}/${options.bundleHash}.ts.bundle?${bundleQuery}`,
    },
    assets: [],
    metadata: {},
    extra: {
      eas: {},
      expoClient: {
        ...expoClient,
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

  const body = `--${boundary}\r\ncontent-disposition: form-data; name="manifest"\r\ncontent-type: application/json\r\n\r\n${JSON.stringify(manifest)}\r\n--${boundary}--\r\n`;
  return { body, boundary };
}

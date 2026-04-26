import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

import type {
    MobilePreviewManifest,
    MobilePreviewManifestFields,
    MobilePreviewMultipartManifestResponse,
} from './routes';

export interface MobilePreviewManifestContext {
    readonly storeDir: string;
    readonly lanIp: string;
    readonly httpPort: number;
    /**
     * Optional public origin override (e.g. cloudflared / ngrok tunnel).
     * When set, generated `launchAsset.url` and `expoClient.hostUri` use
     * this origin instead of `http://${lanIp}:${httpPort}`. Required when
     * the phone can't reach the dev host's LAN — same shape as
     * `relay.ts`'s `MOBILE_PREVIEW_PUBLIC_URL` env. Trailing slashes are
     * stripped at the call site.
     */
    readonly publicUrl?: string;
}

export function bundleHashToUUID(hash: string): string {
    if (hash.length < 32) return hash;
    const h = hash.toLowerCase().slice(0, 32);
    const variant = ((parseInt(h[16], 16) & 0x3) | 0x8).toString(16);
    const v4 = h.slice(0, 12) + '4' + h.slice(13, 16) + variant + h.slice(17, 32);
    return `${v4.slice(0, 8)}-${v4.slice(8, 12)}-${v4.slice(12, 16)}-${v4.slice(16, 20)}-${v4.slice(20, 32)}`;
}

export function manifestBoundary(bundleHash: string): string {
    return `formdata-${bundleHash.slice(0, 16)}`;
}

export function buildManifest(
    bundleHash: string,
    fields: MobilePreviewManifestFields | null | undefined,
    platform: string,
    context: Pick<MobilePreviewManifestContext, 'lanIp' | 'httpPort' | 'publicUrl'>,
): string {
    const publicUrl = (context.publicUrl ?? '').replace(/\/+$/, '');
    // When publicUrl is set, generated URLs use that origin (so a
    // cloudflared/ngrok tunnel works end-to-end). debuggerHost is the
    // host:port form used in the Expo Go-flavored extras (debuggerHost,
    // hostUri); for the public-tunnel case we strip the scheme and let
    // the implicit 443/80 port stay implicit.
    const baseUrl = publicUrl !== '' ? publicUrl : `http://${context.lanIp}:${context.httpPort}`;
    const debuggerHost =
        publicUrl !== ''
            ? publicUrl.replace(/^https?:\/\//i, '')
            : `${context.lanIp}:${context.httpPort}`;
    const slug = fields?.extra?.expoClient?.slug || 'onlook-preview';
    const uuid = bundleHashToUUID(bundleHash);
    const scopeKey = `@anonymous/${slug}-${uuid}`;

    const bundleQuery =
        `platform=${platform}` +
        '&dev=false&hot=false&lazy=true&minify=true' +
        '&transform.engine=hermes&transform.bytecode=1' +
        '&transform.routerRoot=app&unstable_transformProfile=hermes-stable';
    const launchAssetUrl = `${baseUrl}/${bundleHash}.ts.bundle?${bundleQuery}`;

    const manifest: MobilePreviewManifest = {
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
    const boundary = manifestBoundary(bundleHash);
    return `--${boundary}\r\ncontent-disposition: form-data; name="manifest"\r\ncontent-type: application/json\r\n\r\n${json}\r\n--${boundary}--\r\n`;
}

export function buildMultipartManifestResponse(
    bundleHash: string,
    fields: MobilePreviewManifestFields | null | undefined,
    platform: string,
    context: Pick<MobilePreviewManifestContext, 'lanIp' | 'httpPort' | 'publicUrl'>,
): MobilePreviewMultipartManifestResponse {
    const boundary = manifestBoundary(bundleHash);
    return {
        contentType: `multipart/mixed; boundary=${boundary}`,
        body: buildManifest(bundleHash, fields, platform, context),
    };
}

export function createManifestResponse(
    bundleHash: string,
    fields: MobilePreviewManifestFields | null | undefined,
    platform: string,
    context: Pick<MobilePreviewManifestContext, 'lanIp' | 'httpPort' | 'publicUrl'>,
): Response {
    const manifest = buildMultipartManifestResponse(bundleHash, fields, platform, context);

    return new Response(manifest.body, {
        status: 200,
        headers: new Headers([
            ['expo-protocol-version', '0'],
            ['expo-sfv-version', '0'],
            ['cache-control', 'private, max-age=0'],
            ['content-type', manifest.contentType],
            ['connection', 'keep-alive'],
        ]),
    });
}

export function handleManifestRequest(
    req: Request,
    bundleHash: string,
    context: MobilePreviewManifestContext,
): Response {
    const fieldsPath = join(context.storeDir, bundleHash, 'manifest-fields.json');
    if (!existsSync(fieldsPath)) {
        return Response.json({ error: 'not found' }, { status: 404 });
    }

    const fields = JSON.parse(readFileSync(fieldsPath, 'utf-8')) as MobilePreviewManifestFields;
    const platform = req.headers.get('expo-platform') || 'ios';
    return createManifestResponse(bundleHash, fields, platform, context);
}

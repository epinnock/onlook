/**
 * Type-only route contracts for the mobile-preview server.
 *
 * These mirror the shapes currently served by `server/index.ts` so later work
 * can extract route handlers without changing the wire contract.
 */

export type MobilePreviewHttpMethod = 'GET' | 'POST' | 'OPTIONS';
export type MobilePreviewBundlePlatform = 'ios' | 'android';

export type MobilePreviewBundleHash = string & {
    readonly __mobilePreviewBundleHash: unique symbol;
};

export type MobilePreviewManifestPath = `/manifest/${string}`;
export type MobilePreviewBundlePath = `/${string}.bundle` | `/${string}.ts.bundle`;
export type MobilePreviewExpoNoisePath = '/logs' | '/symbolicate';

export type MobilePreviewHttpPath =
    | '/health'
    | '/status'
    | '/push'
    | MobilePreviewManifestPath
    | MobilePreviewBundlePath
    | MobilePreviewExpoNoisePath;

export type MobilePreviewWsPath = '/' | '/push' | '/status';

export interface MobilePreviewRouteContract<
    Method extends MobilePreviewHttpMethod,
    Path extends string,
    Request,
    Response,
> {
    readonly method: Method;
    readonly path: Path;
    readonly request: Request;
    readonly response: Response;
}

export interface MobilePreviewEmptyRequest {
    readonly params?: never;
    readonly query?: never;
    readonly headers?: never;
    readonly body?: never;
}

export interface MobilePreviewOptionsRequest {
    readonly path: string;
}

export interface MobilePreviewStatusSnapshot {
    readonly runtimeHash: string | null;
    readonly clients: number;
}

export interface MobilePreviewHttpStatusResponse extends MobilePreviewStatusSnapshot {
    readonly manifestUrl: string | null;
}

export interface MobilePreviewWsStatusResponse extends MobilePreviewStatusSnapshot {
    readonly lanIp: string;
    readonly httpPort: number;
    readonly wsPort: number;
}

export interface MobilePreviewHealthResponse {
    readonly ok: true;
    readonly version: '0.1.0';
}

export interface MobilePreviewPushRequest {
    readonly body: string;
}

export interface MobilePreviewEvalPushMessage {
    readonly type: 'eval';
    readonly code: string;
}

export interface MobilePreviewPushResponse {
    readonly ok: true;
    readonly clients: number;
}

export interface MobilePreviewManifestRequest {
    readonly params: {
        readonly bundleHash: string;
    };
    readonly headers: {
        readonly expoPlatform?: string;
    };
}

export interface MobilePreviewBundleRequest {
    readonly params: {
        readonly bundleHash: string;
    };
    readonly query: {
        readonly platform?: string;
    };
}

export interface MobilePreviewManifestAsset {
    readonly key: string;
    readonly contentType: string;
    readonly url: string;
    readonly hash?: string;
    readonly fileExtension?: string;
}

export interface MobilePreviewManifestFields {
    readonly runtimeVersion?: string;
    readonly launchAsset?: {
        readonly key?: string;
        readonly contentType?: string;
    };
    readonly assets?: readonly MobilePreviewManifestAsset[];
    readonly metadata?: Record<string, unknown>;
    readonly extra?: {
        readonly expoClient?: Record<string, unknown> & {
            readonly slug?: string;
        };
        readonly scopeKey?: string;
        readonly eas?: Record<string, unknown>;
    };
}

export interface MobilePreviewManifest {
    readonly id: string;
    readonly createdAt: string;
    readonly runtimeVersion: string;
    readonly launchAsset: {
        readonly key: string;
        readonly contentType: 'application/javascript';
        readonly url: string;
    };
    readonly assets: readonly MobilePreviewManifestAsset[];
    readonly metadata: Record<string, unknown>;
    readonly extra: {
        readonly eas: Record<string, unknown>;
        readonly expoClient: Record<string, unknown> & {
            readonly _internal: {
                readonly isDebug: false;
                readonly projectRoot: string;
                readonly dynamicConfigPath: string | null;
                readonly staticConfigPath: string;
                readonly packageJsonPath: string;
            };
            readonly hostUri: string;
        };
        readonly expoGo: {
            readonly debuggerHost: string;
            readonly developer: {
                readonly tool: 'expo-cli';
                readonly projectRoot: string;
            };
            readonly packagerOpts: {
                readonly dev: false;
            };
            readonly mainModuleName: 'index.ts';
        };
        readonly scopeKey: string;
    };
}

export interface MobilePreviewMultipartManifestResponse {
    readonly contentType: `multipart/mixed; boundary=${string}`;
    readonly body: string;
}

export interface MobilePreviewBundleResponse {
    readonly contentType: 'application/javascript; charset=UTF-8';
    readonly body: Uint8Array;
}

export interface MobilePreviewErrorResponse {
    readonly error: string;
}

export type MobilePreviewNotFoundResponse = 'not found' | `bundle not found: ${string}`;

export type MobilePreviewHttpRoute =
    | MobilePreviewRouteContract<'OPTIONS', string, MobilePreviewOptionsRequest, null>
    | MobilePreviewRouteContract<
          'GET',
          '/health',
          MobilePreviewEmptyRequest,
          MobilePreviewHealthResponse
      >
    | MobilePreviewRouteContract<
          'GET',
          '/status',
          MobilePreviewEmptyRequest,
          MobilePreviewHttpStatusResponse
      >
    | MobilePreviewRouteContract<'POST', '/push', MobilePreviewPushRequest, MobilePreviewPushResponse>
    | MobilePreviewRouteContract<
          'GET',
          MobilePreviewManifestPath,
          MobilePreviewManifestRequest,
          MobilePreviewMultipartManifestResponse | MobilePreviewErrorResponse
      >
    | MobilePreviewRouteContract<
          'GET',
          MobilePreviewBundlePath,
          MobilePreviewBundleRequest,
          MobilePreviewBundleResponse | MobilePreviewNotFoundResponse
      >
    | MobilePreviewRouteContract<
          'GET',
          MobilePreviewExpoNoisePath,
          MobilePreviewEmptyRequest,
          Record<string, never>
      >;

export type MobilePreviewWsHttpRoute =
    | MobilePreviewRouteContract<'GET', '/', MobilePreviewEmptyRequest, string>
    | MobilePreviewRouteContract<'POST', '/push', MobilePreviewPushRequest, MobilePreviewPushResponse>
    | MobilePreviewRouteContract<
          'GET',
          '/status',
          MobilePreviewEmptyRequest,
          MobilePreviewWsStatusResponse
      >;

export type MobilePreviewRoute = MobilePreviewHttpRoute | MobilePreviewWsHttpRoute;

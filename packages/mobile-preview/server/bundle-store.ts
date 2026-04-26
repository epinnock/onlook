import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import type { MobilePreviewBundlePlatform, MobilePreviewManifestFields } from './routes';

export const DEFAULT_STORE_DIR = '/tmp/cf-builds';
export const STORE_DIR = process.env.MOBILE_PREVIEW_STORE || DEFAULT_STORE_DIR;
export const RUNTIME_BUNDLE_PATH = join(import.meta.dir, '..', 'runtime', 'bundle.js');

export interface RuntimeStageOptions {
  readonly storeDir?: string;
  readonly runtimePath?: string;
  readonly now?: () => Date;
}

export interface BundleStorePaths {
  readonly dir: string;
  readonly iosBundlePath: string;
  readonly androidBundlePath: string;
  readonly manifestFieldsPath: string;
  readonly metaPath: string;
}

export interface RuntimeBundleMeta {
  readonly sourceHash: string;
  readonly bundleHash: string;
  readonly builtAt: string;
  readonly sizeBytes: number;
}

export let currentRuntimeHash: string | null = null;
// mtimeMs of the source `runtime/bundle.js` at the moment we last staged it.
// Drives source-bundle drift detection in `ensureRuntimeStaged` so a rebuild
// (e.g. after fixing entry.js — see PR #20) is picked up without a server
// restart. Reset alongside `currentRuntimeHash` whenever staleness is
// detected. Module-private; not exported.
let currentRuntimeSourceMtimeMs: number | null = null;

export function getBundleStorePaths(
  bundleHash: string,
  storeDir: string = STORE_DIR,
): BundleStorePaths {
  const dir = join(storeDir, bundleHash);
  return {
    dir,
    iosBundlePath: join(dir, 'index.ios.bundle.js'),
    androidBundlePath: join(dir, 'index.android.bundle.js'),
    manifestFieldsPath: join(dir, 'manifest-fields.json'),
    metaPath: join(dir, 'meta.json'),
  };
}

export function getBundlePath(
  bundleHash: string,
  platform: MobilePreviewBundlePlatform,
  storeDir: string = STORE_DIR,
): string {
  return join(storeDir, bundleHash, `index.${platform}.bundle.js`);
}

export function readManifestFields(
  bundleHash: string,
  storeDir: string = STORE_DIR,
): MobilePreviewManifestFields | null {
  const fieldsPath = getBundleStorePaths(bundleHash, storeDir).manifestFieldsPath;
  if (!existsSync(fieldsPath)) {
    return null;
  }
  return JSON.parse(readFileSync(fieldsPath, 'utf-8')) as MobilePreviewManifestFields;
}

export function readBundle(
  bundleHash: string,
  platform: MobilePreviewBundlePlatform,
  storeDir: string = STORE_DIR,
): Uint8Array | null {
  const bundlePath = getBundlePath(bundleHash, platform, storeDir);
  if (!existsSync(bundlePath)) {
    return null;
  }
  return readFileSync(bundlePath);
}

export function ensureRuntimeStaged(options: RuntimeStageOptions = {}): string {
  const runtimePath = options.runtimePath ?? RUNTIME_BUNDLE_PATH;
  const storeDir = options.storeDir ?? STORE_DIR;

  // Two staleness modes to defend against:
  //   1. macOS's launchd tmpwatch job wipes `/tmp/cf-builds/*` at midnight,
  //      leaving `currentRuntimeHash` pointing at an empty directory.
  //   2. The source `runtime/bundle.js` gets rebuilt under our feet (e.g.
  //      a developer ran `bun run build:runtime` after pulling a fix —
  //      PR #20 was the canonical example). The on-disk hash dir still
  //      exists, but it was staged from the OLD bundle, so we'd happily
  //      serve a stale manifest pointing at the OLD bundle URL.
  // Bail out of the cache when EITHER signal indicates a re-stage is needed.
  if (currentRuntimeHash) {
    const cachedPaths = getBundleStorePaths(currentRuntimeHash, storeDir);
    const filesPresent =
      existsSync(cachedPaths.manifestFieldsPath) &&
      existsSync(cachedPaths.iosBundlePath);
    const sourceMtimeMs = existsSync(runtimePath)
      ? statSync(runtimePath).mtimeMs
      : null;
    const sourceUnchanged =
      sourceMtimeMs !== null && sourceMtimeMs === currentRuntimeSourceMtimeMs;
    if (filesPresent && sourceUnchanged) {
      return currentRuntimeHash;
    }
    // Cache is stale — fall through to re-stage.
    currentRuntimeHash = null;
    currentRuntimeSourceMtimeMs = null;
  }

  if (!existsSync(runtimePath)) {
    throw new Error(
      `Runtime bundle not found at ${runtimePath}. Run: bun run packages/mobile-preview/server/build-runtime.ts`,
    );
  }

  const bundle = readFileSync(runtimePath);
  const hash = createHash('sha256').update(bundle).digest('hex');
  const paths = getBundleStorePaths(hash, storeDir);

  mkdirSync(paths.dir, { recursive: true });
  writeFileSync(paths.iosBundlePath, bundle);
  writeFileSync(paths.androidBundlePath, bundle);

  const fields: MobilePreviewManifestFields = {
    runtimeVersion: '1.0.0',
    launchAsset: { key: `bundle-${hash}`, contentType: 'application/javascript' },
    assets: [],
    metadata: {},
    extra: {
      expoClient: {
        name: 'onlook-preview',
        slug: 'onlook-preview',
        version: '1.0.0',
        sdkVersion: '54.0.0',
        platforms: ['ios', 'android'],
        newArchEnabled: true,
      },
      scopeKey: '@onlook/mobile-preview',
      eas: { projectId: null },
    },
  };
  writeFileSync(paths.manifestFieldsPath, JSON.stringify(fields, null, 2));

  const meta: RuntimeBundleMeta = {
    sourceHash: hash,
    bundleHash: hash,
    builtAt: (options.now ?? (() => new Date()))().toISOString(),
    sizeBytes: bundle.length,
  };
  writeFileSync(paths.metaPath, JSON.stringify(meta, null, 2));

  currentRuntimeHash = hash;
  currentRuntimeSourceMtimeMs = statSync(runtimePath).mtimeMs;
  return hash;
}

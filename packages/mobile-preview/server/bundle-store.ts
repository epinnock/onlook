import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
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
  if (currentRuntimeHash) return currentRuntimeHash;

  const runtimePath = options.runtimePath ?? RUNTIME_BUNDLE_PATH;
  if (!existsSync(runtimePath)) {
    throw new Error(
      `Runtime bundle not found at ${runtimePath}. Run: bun run packages/mobile-preview/server/build-runtime.ts`,
    );
  }

  const bundle = readFileSync(runtimePath);
  const hash = createHash('sha256').update(bundle).digest('hex');
  const paths = getBundleStorePaths(hash, options.storeDir ?? STORE_DIR);

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
  return hash;
}

import { createHash } from 'crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

import type { ManifestFields } from './manifest';

export type PreviewPlatform = 'ios' | 'android';

export interface RuntimeStoreOptions {
  now?: () => Date;
  runtimeBundlePath?: string;
  storeDir: string;
}

function buildRuntimeManifestFields(hash: string): ManifestFields {
  return {
    runtimeVersion: '1.0.0',
    launchAsset: {
      key: `bundle-${hash}`,
      contentType: 'application/javascript',
    },
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
}

export function getDefaultRuntimeBundlePath(): string {
  return join(import.meta.dir, '..', 'runtime', 'bundle.js');
}

export function createRuntimeStore(options: RuntimeStoreOptions) {
  let currentRuntimeHash: string | null = null;
  const runtimeBundlePath = options.runtimeBundlePath ?? getDefaultRuntimeBundlePath();

  return {
    ensureRuntimeStaged(): string {
      if (currentRuntimeHash) return currentRuntimeHash;

      if (!existsSync(runtimeBundlePath)) {
        throw new Error(
          `Runtime bundle not found at ${runtimeBundlePath}. Run: bun run packages/mobile-preview/server/build-runtime.ts`,
        );
      }

      const bundle = readFileSync(runtimeBundlePath);
      const hash = createHash('sha256').update(bundle).digest('hex');
      const runtimeDir = join(options.storeDir, hash);
      const timestamp = (options.now ?? (() => new Date()))().toISOString();

      mkdirSync(runtimeDir, { recursive: true });
      writeFileSync(join(runtimeDir, 'index.ios.bundle.js'), bundle);
      writeFileSync(join(runtimeDir, 'index.android.bundle.js'), bundle);
      writeFileSync(
        join(runtimeDir, 'manifest-fields.json'),
        JSON.stringify(buildRuntimeManifestFields(hash), null, 2),
      );
      writeFileSync(
        join(runtimeDir, 'meta.json'),
        JSON.stringify(
          {
            sourceHash: hash,
            bundleHash: hash,
            builtAt: timestamp,
            sizeBytes: bundle.length,
          },
          null,
          2,
        ),
      );

      currentRuntimeHash = hash;
      return hash;
    },

    getCurrentRuntimeHash(): string | null {
      return currentRuntimeHash;
    },

    getManifestFields(bundleHash: string): ManifestFields | null {
      const fieldsPath = join(options.storeDir, bundleHash, 'manifest-fields.json');
      if (!existsSync(fieldsPath)) return null;

      return JSON.parse(readFileSync(fieldsPath, 'utf-8')) as ManifestFields;
    },

    getBundle(bundleHash: string, platform: PreviewPlatform) {
      const bundlePath = join(options.storeDir, bundleHash, `index.${platform}.bundle.js`);
      if (!existsSync(bundlePath)) return null;

      return readFileSync(bundlePath);
    },
  };
}

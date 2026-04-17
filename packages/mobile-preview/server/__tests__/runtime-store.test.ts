import { afterEach, describe, expect, it } from 'bun:test';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import {
  DEFAULT_EXPO_SDK_VERSION,
  RUNTIME_BUILD_METADATA_FILENAME,
} from '../build-runtime';
import { createRuntimeStore } from '../runtime-store';

const tempDirs: string[] = [];

function createTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'mobile-preview-runtime-store-'));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('runtime store', () => {
  it('stages the runtime SDK version from build metadata', () => {
    const rootDir = createTempDir();
    const runtimeDir = join(rootDir, 'runtime');
    const storeDir = join(rootDir, 'store');
    const runtimeBundlePath = join(runtimeDir, 'bundle.js');

    mkdirSync(runtimeDir, { recursive: true });
    writeFileSync(runtimeBundlePath, 'console.log("runtime bundle");');
    writeFileSync(
      join(runtimeDir, RUNTIME_BUILD_METADATA_FILENAME),
      JSON.stringify({ sdkVersion: '55.0.0' }, null, 2),
    );

    const runtimeStore = createRuntimeStore({
      storeDir,
      runtimeBundlePath,
      now: () => new Date('2024-01-02T03:04:05.000Z'),
    });

    const runtimeHash = runtimeStore.ensureRuntimeStaged();
    const stagedDir = join(storeDir, runtimeHash);
    const manifestFields = JSON.parse(readFileSync(join(stagedDir, 'manifest-fields.json'), 'utf-8')) as {
      extra?: {
        expoClient?: {
          sdkVersion?: string;
        };
      };
    };
    const runtimeBuildMetadata = JSON.parse(
      readFileSync(join(stagedDir, RUNTIME_BUILD_METADATA_FILENAME), 'utf-8'),
    ) as {
      sdkVersion: string;
    };

    expect(manifestFields.extra?.expoClient?.sdkVersion).toBe('55.0.0');
    expect(runtimeBuildMetadata).toEqual({ sdkVersion: '55.0.0' });
  });

  it('falls back to the default runtime SDK version when build metadata is missing', () => {
    const rootDir = createTempDir();
    const runtimeDir = join(rootDir, 'runtime');
    const storeDir = join(rootDir, 'store');
    const runtimeBundlePath = join(runtimeDir, 'bundle.js');

    mkdirSync(runtimeDir, { recursive: true });
    writeFileSync(runtimeBundlePath, 'console.log("runtime bundle");');

    const runtimeStore = createRuntimeStore({
      storeDir,
      runtimeBundlePath,
      now: () => new Date('2024-01-02T03:04:05.000Z'),
    });

    const runtimeHash = runtimeStore.ensureRuntimeStaged();
    const stagedDir = join(storeDir, runtimeHash);
    const manifestFields = JSON.parse(readFileSync(join(stagedDir, 'manifest-fields.json'), 'utf-8')) as {
      extra?: {
        expoClient?: {
          sdkVersion?: string;
        };
      };
    };
    const runtimeBuildMetadata = JSON.parse(
      readFileSync(join(stagedDir, RUNTIME_BUILD_METADATA_FILENAME), 'utf-8'),
    ) as {
      sdkVersion: string;
    };

    expect(manifestFields.extra?.expoClient?.sdkVersion).toBe(DEFAULT_EXPO_SDK_VERSION);
    expect(runtimeBuildMetadata).toEqual({ sdkVersion: DEFAULT_EXPO_SDK_VERSION });
  });
});

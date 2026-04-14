import { afterEach, describe, expect, it } from 'bun:test';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import { createMobilePreviewServer } from '../index';

const tempDirs: string[] = [];

function createTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'mobile-preview-server-'));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('mobile preview server', () => {
  it('stages a runtime bundle and serves consistent status, manifest, and bundle responses', async () => {
    const rootDir = createTempDir();
    const storeDir = join(rootDir, 'store');
    const runtimeDir = join(rootDir, 'runtime');
    const runtimeBundlePath = join(runtimeDir, 'bundle.js');
    const runtimeBundle = 'console.log("runtime bundle");';

    mkdirSync(runtimeDir, { recursive: true });
    writeFileSync(runtimeBundlePath, runtimeBundle);

    const server = createMobilePreviewServer({
      httpPort: 4100,
      wsPort: 4101,
      storeDir,
      lanIp: '10.0.0.5',
      runtimeBundlePath,
      now: () => new Date('2024-01-02T03:04:05.000Z'),
      logger: {
        log() {},
        error() {},
      },
    });

    const runtimeHash = server.runtimeStore.ensureRuntimeStaged();
    expect(server.runtimeStore.ensureRuntimeStaged()).toBe(runtimeHash);

    const stagedDir = join(storeDir, runtimeHash);
    expect(readFileSync(join(stagedDir, 'index.ios.bundle.js'), 'utf-8')).toBe(runtimeBundle);
    expect(readFileSync(join(stagedDir, 'index.android.bundle.js'), 'utf-8')).toBe(runtimeBundle);
    expect(
      JSON.parse(readFileSync(join(stagedDir, 'meta.json'), 'utf-8')) as {
        bundleHash: string;
        builtAt: string;
        sizeBytes: number;
        sourceHash: string;
      },
    ).toEqual({
      sourceHash: runtimeHash,
      bundleHash: runtimeHash,
      builtAt: '2024-01-02T03:04:05.000Z',
      sizeBytes: runtimeBundle.length,
    });

    const fetchHandler = server.createHttpFetchHandler();

    const statusResponse = await fetchHandler(new Request('http://localhost/status'));
    expect(statusResponse.status).toBe(200);
    expect(statusResponse.headers.get('Access-Control-Allow-Origin')).toBe('*');
    expect(
      (await statusResponse.json()) as {
        clients: number;
        manifestUrl: string;
        runtimeHash: string;
      },
    ).toEqual({
      runtimeHash,
      clients: 0,
      manifestUrl: `exp://10.0.0.5:4100/manifest/${runtimeHash}`,
    });

    const pushResponse = await fetchHandler(
      new Request('http://localhost/push', {
        method: 'POST',
        body: '{"type":"eval"}',
      }),
    );
    expect(pushResponse.status).toBe(200);
    expect((await pushResponse.json()) as { clients: number; ok: boolean }).toEqual({
      ok: true,
      clients: 0,
    });

    const manifestResponse = await fetchHandler(
      new Request(`http://localhost/manifest/${runtimeHash}`, {
        headers: {
          'expo-platform': 'android',
        },
      }),
    );
    expect(manifestResponse.status).toBe(200);
    expect(manifestResponse.headers.get('content-type')).toBe(
      `multipart/mixed; boundary=formdata-${runtimeHash.slice(0, 16)}`,
    );

    const manifestBody = await manifestResponse.text();
    expect(manifestBody).toContain(
      `"url":"http://10.0.0.5:4100/${runtimeHash}.ts.bundle?platform=android`,
    );
    expect(manifestBody).toContain(`"scopeKey":"@anonymous/onlook-preview-`);

    const bundleResponse = await fetchHandler(
      new Request(`http://localhost/${runtimeHash}.ts.bundle?platform=android`),
    );
    expect(bundleResponse.status).toBe(200);
    expect(bundleResponse.headers.get('content-type')).toBe(
      'application/javascript; charset=UTF-8',
    );
    expect(await bundleResponse.text()).toBe(runtimeBundle);
  });
});

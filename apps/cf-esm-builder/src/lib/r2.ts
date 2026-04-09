/**
 * R2 helpers for the `expo-bundles` bucket (TH2.5).
 *
 * Layout source of truth: `plans/expo-browser-bundle-artifact.md` §R2 layout.
 *
 *   expo-bundles/
 *   └── bundle/${bundleHash}/
 *       ├── index.android.bundle    ← Hermes bytecode (android target)
 *       ├── index.ios.bundle        ← Hermes bytecode (ios target)
 *       ├── assetmap.json
 *       ├── sourcemap.json
 *       ├── manifest-fields.json
 *       └── meta.json               ← written LAST (sentinel for readers)
 *
 * Both platform bundles are produced by every Container build (see
 * `apps/cf-esm-builder/container/build.sh`) so the relay can route a
 * single manifest URL to the right launchAsset based on the
 * `Expo-Platform` header from Expo Go.
 *
 * Keep this module thin: it owns key construction and JSON
 * serialisation, nothing else. Routes (TH2.3) and the BuildSession DO
 * (TH2.4) call these helpers; tests stub `env.BUNDLES` directly.
 */
import type { Env } from '../types';

export type BundlePlatform = 'android' | 'ios';

export interface BundleMeta {
    sourceHash: string;
    bundleHash: string;
    builtAt: string;
    sizeBytes: number;
    hermesVersion?: string;
    /** Per-platform Hermes bundle byte sizes. */
    platformSizes?: { android?: number; ios?: number };
}

export interface BundleArtifact {
    bundle: ReadableStream<Uint8Array> | null;
    meta: BundleMeta | null;
}

const META_FILENAME = 'meta.json';

function bundleFilename(platform: BundlePlatform): string {
    return `index.${platform}.bundle`;
}

function bundleKey(hash: string, platform: BundlePlatform = 'android'): string {
    return `bundle/${hash}/${bundleFilename(platform)}`;
}

function metaKey(hash: string): string {
    return `bundle/${hash}/${META_FILENAME}`;
}

function fileKey(hash: string, path: string): string {
    return `bundle/${hash}/${path}`;
}

/**
 * Read the Hermes bundle bytes from R2 for a given hash + platform.
 * Returns null on miss. Defaults to `'android'` so existing single-platform
 * call sites keep their behavior.
 */
export async function r2GetBundle(
    env: Env,
    hash: string,
    platform: BundlePlatform = 'android',
): Promise<R2ObjectBody | null> {
    return await env.BUNDLES.get(bundleKey(hash, platform));
}

/** Read the meta.json for a build. Returns null on miss. */
export async function r2GetMeta(env: Env, hash: string): Promise<BundleMeta | null> {
    const obj = await env.BUNDLES.get(metaKey(hash));
    if (!obj) return null;
    const text = await obj.text();
    return JSON.parse(text) as BundleMeta;
}

/**
 * Write the per-platform Hermes bundle from a stream or buffer.
 * Defaults to `'android'` so existing single-platform call sites keep
 * their behavior; iOS uploads pass `'ios'` explicitly.
 */
export async function r2PutBundle(
    env: Env,
    hash: string,
    body: ReadableStream<Uint8Array> | ArrayBuffer,
    platform: BundlePlatform = 'android',
): Promise<void> {
    await env.BUNDLES.put(bundleKey(hash, platform), body, {
        httpMetadata: { contentType: 'application/javascript' },
    });
}

/** Write meta.json. Always written LAST so readers can use it as a completion sentinel. */
export async function r2PutMeta(env: Env, hash: string, meta: object): Promise<void> {
    await env.BUNDLES.put(metaKey(hash), JSON.stringify(meta), {
        httpMetadata: { contentType: 'application/json' },
    });
}

/** Read an arbitrary file under `bundle/${hash}/${path}`. */
export async function r2GetBundleFile(
    env: Env,
    hash: string,
    path: string,
): Promise<R2ObjectBody | null> {
    return await env.BUNDLES.get(fileKey(hash, path));
}

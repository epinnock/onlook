/**
 * R2 helpers for the `expo-bundles` bucket (TH2.5).
 *
 * Layout source of truth: `plans/expo-browser-bundle-artifact.md` §R2 layout.
 *
 *   expo-bundles/
 *   └── bundle/${bundleHash}/
 *       ├── index.android.bundle    ← Hermes bytecode
 *       ├── assetmap.json
 *       ├── sourcemap.json
 *       ├── manifest-fields.json
 *       └── meta.json               ← written LAST (sentinel for readers)
 *
 * Keep this module thin: it owns key construction and JSON
 * serialisation, nothing else. Routes (TH2.3) and the BuildSession DO
 * (TH2.4) call these helpers; tests stub `env.BUNDLES` directly.
 */
import type { Env } from '../types';

export interface BundleMeta {
    sourceHash: string;
    bundleHash: string;
    builtAt: string;
    sizeBytes: number;
    hermesVersion?: string;
}

export interface BundleArtifact {
    bundle: ReadableStream<Uint8Array> | null;
    meta: BundleMeta | null;
}

const BUNDLE_FILENAME = 'index.android.bundle';
const META_FILENAME = 'meta.json';

function bundleKey(hash: string): string {
    return `bundle/${hash}/${BUNDLE_FILENAME}`;
}

function metaKey(hash: string): string {
    return `bundle/${hash}/${META_FILENAME}`;
}

function fileKey(hash: string, path: string): string {
    return `bundle/${hash}/${path}`;
}

/** Read the Hermes bundle bytes from R2 for a given hash. Returns null on miss. */
export async function r2GetBundle(env: Env, hash: string): Promise<R2ObjectBody | null> {
    return await env.BUNDLES.get(bundleKey(hash));
}

/** Read the meta.json for a build. Returns null on miss. */
export async function r2GetMeta(env: Env, hash: string): Promise<BundleMeta | null> {
    const obj = await env.BUNDLES.get(metaKey(hash));
    if (!obj) return null;
    const text = await obj.text();
    return JSON.parse(text) as BundleMeta;
}

/** Write index.android.bundle from a stream or buffer. */
export async function r2PutBundle(
    env: Env,
    hash: string,
    body: ReadableStream<Uint8Array> | ArrayBuffer,
): Promise<void> {
    await env.BUNDLES.put(bundleKey(hash), body, {
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

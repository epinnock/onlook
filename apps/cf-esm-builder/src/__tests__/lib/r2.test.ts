/**
 * Tests for `lib/r2.ts` (TH2.5).
 *
 * Stubs `env.BUNDLES` with a minimal in-memory R2 fake that records the
 * keys/values passed to `get`/`put`. R2 layout contract lives in
 * `plans/expo-browser-bundle-artifact.md` §R2 layout.
 */
import { describe, expect, test } from 'bun:test';
import {
    r2GetBundle,
    r2GetBundleFile,
    r2GetMeta,
    r2PutBundle,
    r2PutMeta,
} from '../../lib/r2';
import type { Env } from '../../types';

interface PutCall {
    key: string;
    value: unknown;
    options?: R2PutOptions;
}

interface GetCall {
    key: string;
}

interface FakeBundles {
    bucket: R2Bucket;
    putCalls: PutCall[];
    getCalls: GetCall[];
    store: Map<string, { body: unknown; options?: R2PutOptions }>;
}

function makeFakeBundles(opts: {
    getHandler?: (key: string) => R2ObjectBody | null;
} = {}): FakeBundles {
    const putCalls: PutCall[] = [];
    const getCalls: GetCall[] = [];
    const store = new Map<string, { body: unknown; options?: R2PutOptions }>();

    const bucket = {
        get: async (key: string): Promise<R2ObjectBody | null> => {
            getCalls.push({ key });
            if (opts.getHandler) return opts.getHandler(key);
            const entry = store.get(key);
            if (!entry) return null;
            return makeR2ObjectBody(entry.body);
        },
        put: async (
            key: string,
            value: unknown,
            options?: R2PutOptions,
        ): Promise<R2Object> => {
            putCalls.push({ key, value, options });
            store.set(key, { body: value, options });
            return { key } as unknown as R2Object;
        },
        head: async (_key: string): Promise<R2Object | null> => null,
        delete: async (): Promise<void> => {},
        list: async (): Promise<R2Objects> =>
            ({ objects: [], truncated: false, delimitedPrefixes: [] }) as unknown as R2Objects,
        createMultipartUpload: async (): Promise<R2MultipartUpload> => {
            throw new Error('not implemented in fake');
        },
        resumeMultipartUpload: (): R2MultipartUpload => {
            throw new Error('not implemented in fake');
        },
    } as unknown as R2Bucket;

    return { bucket, putCalls, getCalls, store };
}

/** Build a minimal R2ObjectBody fake from a string body. */
function makeR2ObjectBody(body: unknown): R2ObjectBody {
    const text = typeof body === 'string' ? body : JSON.stringify(body);
    const bytes = new TextEncoder().encode(text);
    return {
        text: async () => text,
        json: async () => JSON.parse(text),
        arrayBuffer: async () => bytes.buffer,
        body: new ReadableStream(),
        bodyUsed: false,
        blob: async () => new Blob([bytes]),
    } as unknown as R2ObjectBody;
}

function makeEnv(bundles: FakeBundles): Env {
    return {
        ESM_BUILDER: {} as unknown as Env['ESM_BUILDER'],
        BUILD_SESSION: {} as unknown as Env['BUILD_SESSION'],
        BUNDLES: bundles.bucket,
    };
}

const HASH = 'abc123def4567890abc123def4567890abc123def4567890abc123def4567890';

describe('lib/r2 — r2GetBundle', () => {
    test('returns the R2ObjectBody on hit', async () => {
        const bundles = makeFakeBundles();
        bundles.store.set(`bundle/${HASH}/index.android.bundle`, { body: 'bundle-bytes' });
        const env = makeEnv(bundles);

        const obj = await r2GetBundle(env, HASH);
        expect(obj).not.toBeNull();
        expect(bundles.getCalls[0]?.key).toBe(`bundle/${HASH}/index.android.bundle`);
    });

    test('returns null on miss', async () => {
        const bundles = makeFakeBundles({ getHandler: () => null });
        const env = makeEnv(bundles);

        const obj = await r2GetBundle(env, HASH);
        expect(obj).toBeNull();
        expect(bundles.getCalls[0]?.key).toBe(`bundle/${HASH}/index.android.bundle`);
    });
});

describe('lib/r2 — r2PutBundle', () => {
    test('writes to the canonical bundle key with javascript content-type', async () => {
        const bundles = makeFakeBundles();
        const env = makeEnv(bundles);
        const body = new ArrayBuffer(8);

        await r2PutBundle(env, HASH, body);

        expect(bundles.putCalls).toHaveLength(1);
        expect(bundles.putCalls[0]?.key).toBe(`bundle/${HASH}/index.android.bundle`);
        expect(bundles.putCalls[0]?.options?.httpMetadata).toMatchObject({
            contentType: 'application/javascript',
        });
    });

    test("writes to index.ios.bundle when platform='ios'", async () => {
        const bundles = makeFakeBundles();
        const env = makeEnv(bundles);
        const body = new ArrayBuffer(8);

        await r2PutBundle(env, HASH, body, 'ios');

        expect(bundles.putCalls).toHaveLength(1);
        expect(bundles.putCalls[0]?.key).toBe(`bundle/${HASH}/index.ios.bundle`);
    });

    test("writes to index.android.bundle when platform='android'", async () => {
        const bundles = makeFakeBundles();
        const env = makeEnv(bundles);
        const body = new ArrayBuffer(8);

        await r2PutBundle(env, HASH, body, 'android');

        expect(bundles.putCalls).toHaveLength(1);
        expect(bundles.putCalls[0]?.key).toBe(`bundle/${HASH}/index.android.bundle`);
    });
});

describe('lib/r2 — r2GetBundle (per-platform)', () => {
    test("returns the ios bundle when platform='ios'", async () => {
        const bundles = makeFakeBundles();
        bundles.store.set(`bundle/${HASH}/index.ios.bundle`, { body: 'ios-bytes' });
        const env = makeEnv(bundles);

        const obj = await r2GetBundle(env, HASH, 'ios');
        expect(obj).not.toBeNull();
        expect(bundles.getCalls[0]?.key).toBe(`bundle/${HASH}/index.ios.bundle`);
    });

    test("returns the android bundle when platform='android'", async () => {
        const bundles = makeFakeBundles();
        bundles.store.set(`bundle/${HASH}/index.android.bundle`, { body: 'android-bytes' });
        const env = makeEnv(bundles);

        const obj = await r2GetBundle(env, HASH, 'android');
        expect(obj).not.toBeNull();
        expect(bundles.getCalls[0]?.key).toBe(`bundle/${HASH}/index.android.bundle`);
    });

    test("ios miss does not return the android object stored under a different key", async () => {
        const bundles = makeFakeBundles();
        bundles.store.set(`bundle/${HASH}/index.android.bundle`, { body: 'android-bytes' });
        const env = makeEnv(bundles);

        const obj = await r2GetBundle(env, HASH, 'ios');
        expect(obj).toBeNull();
    });
});

describe('lib/r2 — r2GetMeta', () => {
    test('parses the JSON body into a BundleMeta object', async () => {
        const meta = {
            sourceHash: HASH,
            bundleHash: HASH,
            builtAt: '2026-04-07T12:00:00Z',
            sizeBytes: 1234,
            hermesVersion: '0.12.0',
        };
        const bundles = makeFakeBundles();
        bundles.store.set(`bundle/${HASH}/meta.json`, { body: JSON.stringify(meta) });
        const env = makeEnv(bundles);

        const parsed = await r2GetMeta(env, HASH);
        expect(parsed).toEqual(meta);
        expect(bundles.getCalls[0]?.key).toBe(`bundle/${HASH}/meta.json`);
    });

    test('returns null on miss', async () => {
        const bundles = makeFakeBundles({ getHandler: () => null });
        const env = makeEnv(bundles);

        const parsed = await r2GetMeta(env, HASH);
        expect(parsed).toBeNull();
    });
});

describe('lib/r2 — r2PutMeta', () => {
    test('stringifies the object and writes to meta.json with json content-type', async () => {
        const bundles = makeFakeBundles();
        const env = makeEnv(bundles);
        const meta = { sourceHash: HASH, bundleHash: HASH, builtAt: 'now', sizeBytes: 42 };

        await r2PutMeta(env, HASH, meta);

        expect(bundles.putCalls).toHaveLength(1);
        expect(bundles.putCalls[0]?.key).toBe(`bundle/${HASH}/meta.json`);
        expect(bundles.putCalls[0]?.value).toBe(JSON.stringify(meta));
        expect(bundles.putCalls[0]?.options?.httpMetadata).toMatchObject({
            contentType: 'application/json',
        });
    });
});

describe('lib/r2 — r2GetBundleFile', () => {
    test('constructs bundle/${hash}/${path} key', async () => {
        const bundles = makeFakeBundles();
        bundles.store.set(`bundle/${HASH}/assetmap.json`, { body: '{"assets":[]}' });
        const env = makeEnv(bundles);

        const obj = await r2GetBundleFile(env, HASH, 'assetmap.json');
        expect(obj).not.toBeNull();
        expect(bundles.getCalls[0]?.key).toBe(`bundle/${HASH}/assetmap.json`);
    });

    test('returns null on miss', async () => {
        const bundles = makeFakeBundles({ getHandler: () => null });
        const env = makeEnv(bundles);

        const obj = await r2GetBundleFile(env, HASH, 'sourcemap.json');
        expect(obj).toBeNull();
        expect(bundles.getCalls[0]?.key).toBe(`bundle/${HASH}/sourcemap.json`);
    });
});

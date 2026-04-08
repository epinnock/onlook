/// <reference types="bun" />
/**
 * TH3.2 — `POST /invalidate` route tests.
 *
 * Fakes `env.BUNDLES` with a minimal in-memory bucket that records list +
 * delete calls; `env.BUILDER` is stubbed but never reached by these tests.
 */
import { describe, expect, test } from 'bun:test';

import { handleInvalidate } from '../../routes/invalidate';
import type { Env } from '../../worker';

interface ListCall {
    prefix: string;
}

interface DeleteCall {
    keys: string[];
}

interface BundlesStub {
    bucket: R2Bucket;
    listCalls: ListCall[];
    deleteCalls: DeleteCall[];
}

function makeBundlesStub(keys: string[]): BundlesStub {
    const listCalls: ListCall[] = [];
    const deleteCalls: DeleteCall[] = [];
    const store = new Set(keys);

    const bucket = {
        async list(options?: { prefix?: string }): Promise<{
            objects: { key: string }[];
        }> {
            const prefix = options?.prefix ?? '';
            listCalls.push({ prefix });
            const matches = [...store]
                .filter((k) => k.startsWith(prefix))
                .map((key) => ({ key }));
            return { objects: matches };
        },
        async delete(toDelete: string | string[]): Promise<void> {
            const arr = Array.isArray(toDelete) ? toDelete : [toDelete];
            deleteCalls.push({ keys: arr });
            for (const k of arr) store.delete(k);
        },
    };

    return { bucket: bucket as unknown as R2Bucket, listCalls, deleteCalls };
}

function envWith(bundles: BundlesStub): Env {
    return {
        BUNDLES: bundles.bucket,
        BUILDER: { fetch: async () => new Response('unused') } as unknown as Fetcher,
    };
}

function postJson(body: unknown): Request {
    return new Request('https://cache.test/invalidate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: typeof body === 'string' ? body : JSON.stringify(body),
    });
}

const HASH = 'abc123';

describe('handleInvalidate (TH3.2)', () => {
    test('deletes every object under the hash prefix and reports the count', async () => {
        const bundles = makeBundlesStub([
            `bundle/${HASH}/index.android.bundle`,
            `bundle/${HASH}/assetmap.json`,
            `bundle/${HASH}/sourcemap.json`,
            `bundle/${HASH}/manifest-fields.json`,
            `bundle/${HASH}/meta.json`,
            // Unrelated hash must be left alone.
            'bundle/other/meta.json',
        ]);
        const env = envWith(bundles);

        const res = await handleInvalidate(postJson({ hash: HASH }), env);
        expect(res.status).toBe(200);
        const body = (await res.json()) as { ok: boolean; deleted: number };
        expect(body.ok).toBe(true);
        expect(body.deleted).toBe(5);

        expect(bundles.listCalls.length).toBe(1);
        expect(bundles.listCalls[0]?.prefix).toBe(`bundle/${HASH}/`);
        expect(bundles.deleteCalls.length).toBe(1);
        expect(bundles.deleteCalls[0]?.keys).toContain(
            `bundle/${HASH}/index.android.bundle`,
        );
        expect(bundles.deleteCalls[0]?.keys).toContain(`bundle/${HASH}/meta.json`);
        expect(bundles.deleteCalls[0]?.keys).not.toContain('bundle/other/meta.json');
    });

    test('returns 400 when the body is not valid JSON', async () => {
        const bundles = makeBundlesStub([]);
        const env = envWith(bundles);

        const res = await handleInvalidate(postJson('not-json{'), env);
        expect(res.status).toBe(400);
        const body = (await res.json()) as { error: string };
        expect(body.error).toBe('invalid json');
        expect(bundles.listCalls.length).toBe(0);
        expect(bundles.deleteCalls.length).toBe(0);
    });

    test('returns 200 deleted:0 when no objects match the prefix', async () => {
        const bundles = makeBundlesStub([]);
        const env = envWith(bundles);

        const res = await handleInvalidate(postJson({ hash: HASH }), env);
        expect(res.status).toBe(200);
        const body = (await res.json()) as { ok: boolean; deleted: number };
        expect(body.ok).toBe(true);
        expect(body.deleted).toBe(0);
        expect(bundles.listCalls.length).toBe(1);
        // Nothing to delete → delete() must not be called.
        expect(bundles.deleteCalls.length).toBe(0);
    });

    test('returns 400 when hash is missing or not a string', async () => {
        const bundles = makeBundlesStub([]);
        const env = envWith(bundles);

        const missing = await handleInvalidate(postJson({}), env);
        expect(missing.status).toBe(400);
        const missingBody = (await missing.json()) as { error: string };
        expect(missingBody.error).toBe('missing hash');

        const wrongType = await handleInvalidate(postJson({ hash: 42 }), env);
        expect(wrongType.status).toBe(400);
        const wrongTypeBody = (await wrongType.json()) as { error: string };
        expect(wrongTypeBody.error).toBe('missing hash');

        const emptyString = await handleInvalidate(postJson({ hash: '' }), env);
        expect(emptyString.status).toBe(400);

        expect(bundles.listCalls.length).toBe(0);
        expect(bundles.deleteCalls.length).toBe(0);
    });
});

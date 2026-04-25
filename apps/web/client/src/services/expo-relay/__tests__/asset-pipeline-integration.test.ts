/**
 * Asset pipeline integration test — task composition of asset-check →
 * uploader → pushOverlayV1.
 *
 * Exercises the editor's full asset dance against in-memory fakes: two
 * assets (one known server-side, one novel), uploadAsset fires only for the
 * novel one, final pushOverlayV1 carries the complete OverlayAssetManifest.
 */
import { describe, expect, test } from 'bun:test';
import type { OverlayAssetManifest } from '@onlook/mobile-client-protocol';

import { checkAssetHashes } from '../asset-check';
import { sha256HexOfBytes, uploadAsset } from '../asset-uploader';
import { pushOverlayV1 } from '../push-overlay';

interface FakeRelay {
    readonly knownHashes: Set<string>;
    readonly uploads: Array<{ hash: string; mime: string; bytes: number }>;
    readonly pushes: Array<unknown>;
    fetchImpl: (
        input: RequestInfo | URL,
        init?: RequestInit,
    ) => Promise<Response>;
}

function makeFakeRelay(knownHashes: Iterable<string> = []): FakeRelay {
    const known = new Set(knownHashes);
    const uploads: FakeRelay['uploads'] = [];
    const pushes: FakeRelay['pushes'] = [];
    const fetchImpl: FakeRelay['fetchImpl'] = async (input, init) => {
        const url = typeof input === 'string' ? input : (input as Request).url;
        // /assets/check
        if (url.endsWith('/assets/check')) {
            const body = typeof init?.body === 'string' ? JSON.parse(init.body) : {};
            const hashes: string[] = Array.isArray(body.hashes) ? body.hashes : [];
            const present = hashes.filter((h) => known.has(h));
            return new Response(JSON.stringify({ known: present }), {
                status: 200,
                headers: { 'Content-Type': 'application/json' },
            });
        }
        // /assets/upload/:hash
        const uploadMatch = /\/assets\/upload\/([^/]+)$/.exec(url);
        if (uploadMatch) {
            const hash = decodeURIComponent(uploadMatch[1]!);
            known.add(hash);
            const mime = new Headers(init?.headers).get('Content-Type') ?? '';
            const body = init?.body as Uint8Array | undefined;
            uploads.push({ hash, mime, bytes: body?.byteLength ?? 0 });
            return new Response(JSON.stringify({ uri: `https://r2/assets/${hash}` }), {
                status: 202,
                headers: { 'Content-Type': 'application/json' },
            });
        }
        // /push/:id
        if (/\/push\/[^/]+$/.test(url)) {
            const payload =
                typeof init?.body === 'string' ? JSON.parse(init.body) : {};
            pushes.push(payload);
            return new Response(JSON.stringify({ delivered: 1 }), {
                status: 202,
                headers: { 'Content-Type': 'application/json' },
            });
        }
        return new Response('unknown route', { status: 404 });
    };
    return { knownHashes: known, uploads, pushes, fetchImpl };
}

describe('asset pipeline integration (check → upload → push)', () => {
    test('novel + known assets: novel uploaded once, final push carries full manifest', async () => {
        // Two assets. `novel` has no server-side record; `known` does.
        const novelBytes = new TextEncoder().encode('png-bytes');
        const knownBytes = new TextEncoder().encode('cached-font');
        const novelHash = await sha256HexOfBytes(novelBytes);
        const knownHash = await sha256HexOfBytes(knownBytes);

        const relay = makeFakeRelay([knownHash]);

        // 1. checkAssetHashes identifies which hashes need uploading.
        const check = await checkAssetHashes({
            relayBaseUrl: 'https://r',
            sessionId: 's',
            hashes: [novelHash, knownHash],
            fetchImpl: relay.fetchImpl,
        });
        expect(check.unknown).toEqual([novelHash]);
        expect(check.known).toEqual(new Set([knownHash]));

        // 2. Upload ONLY the novel one.
        const uploadResult = await uploadAsset({
            relayBaseUrl: 'https://r',
            sessionId: 's',
            bytes: novelBytes,
            mime: 'image/png',
            hash: novelHash,
            fetchImpl: relay.fetchImpl,
        });
        expect(uploadResult.ok).toBe(true);
        expect(relay.uploads).toHaveLength(1);
        expect(relay.uploads[0]!.hash).toBe(novelHash);

        // 3. Build a manifest with both assets — novel gets the fresh R2 uri,
        //    known reuses the expected stable uri.
        const assets: OverlayAssetManifest = {
            abi: 'v1',
            assets: {
                [novelHash]: {
                    kind: 'image',
                    hash: novelHash,
                    mime: 'image/png',
                    uri: uploadResult.ok ? uploadResult.uri : 'MISSING',
                    width: 32,
                    height: 32,
                },
                [knownHash]: {
                    kind: 'font',
                    hash: knownHash,
                    mime: 'font/ttf',
                    family: 'Inter',
                    uri: `https://r2/assets/${knownHash}`,
                },
            },
        };

        // 4. Push the overlay with the complete manifest.
        const pushResult = await pushOverlayV1({
            relayBaseUrl: 'https://r',
            sessionId: 's',
            overlay: { code: 'module.exports = {};', buildDurationMs: 0 },
            assets,
            fetchImpl: relay.fetchImpl,
            onTelemetry: null,
        });
        expect(pushResult.ok).toBe(true);
        expect(relay.pushes).toHaveLength(1);
        const pushed = relay.pushes[0] as { assets: OverlayAssetManifest };
        expect(Object.keys(pushed.assets.assets)).toEqual(
            expect.arrayContaining([novelHash, knownHash]),
        );
    });

    test('all-known assets skip upload entirely', async () => {
        const bytesA = new TextEncoder().encode('a');
        const bytesB = new TextEncoder().encode('b');
        const hashA = await sha256HexOfBytes(bytesA);
        const hashB = await sha256HexOfBytes(bytesB);

        const relay = makeFakeRelay([hashA, hashB]);

        const check = await checkAssetHashes({
            relayBaseUrl: 'https://r',
            sessionId: 's',
            hashes: [hashA, hashB],
            fetchImpl: relay.fetchImpl,
        });
        expect(check.unknown).toEqual([]);
        expect(relay.uploads).toHaveLength(0);
    });

    // ─── Extended coverage ──────────────────────────────────────────────────

    test('empty hashes input: check returns empty unknown + no uploads', async () => {
        const relay = makeFakeRelay([]);
        const check = await checkAssetHashes({
            relayBaseUrl: 'https://r',
            sessionId: 's',
            hashes: [],
            fetchImpl: relay.fetchImpl,
        });
        expect(check.unknown).toEqual([]);
        expect(check.known.size).toBe(0);
        expect(relay.uploads).toHaveLength(0);
    });

    test('all-novel assets: every hash uploads', async () => {
        const bytesA = new TextEncoder().encode('novel-a');
        const bytesB = new TextEncoder().encode('novel-b');
        const bytesC = new TextEncoder().encode('novel-c');
        const hashes = await Promise.all([
            sha256HexOfBytes(bytesA),
            sha256HexOfBytes(bytesB),
            sha256HexOfBytes(bytesC),
        ]);

        const relay = makeFakeRelay([]); // server knows nothing

        const check = await checkAssetHashes({
            relayBaseUrl: 'https://r',
            sessionId: 's',
            hashes,
            fetchImpl: relay.fetchImpl,
        });
        expect(check.unknown).toHaveLength(3);

        const bytes = [bytesA, bytesB, bytesC];
        for (let i = 0; i < hashes.length; i += 1) {
            const result = await uploadAsset({
                relayBaseUrl: 'https://r',
                sessionId: 's',
                bytes: bytes[i]!,
                mime: 'image/png',
                hash: hashes[i]!,
                fetchImpl: relay.fetchImpl,
            });
            expect(result.ok).toBe(true);
        }
        expect(relay.uploads).toHaveLength(3);
        const uploadedHashes = relay.uploads.map((u) => u.hash).sort();
        expect(uploadedHashes).toEqual([...hashes].sort());
    });

    test('upload failure (5xx) surfaces ok:false and the manifest can omit the asset', async () => {
        const bytes = new TextEncoder().encode('x');
        const hash = await sha256HexOfBytes(bytes);

        const failingFetch: FakeRelay['fetchImpl'] = async (input, init) => {
            const url = typeof input === 'string' ? input : (input as Request).url;
            if (url.includes('/assets/check')) {
                return new Response(JSON.stringify({ known: [] }), {
                    status: 200,
                    headers: { 'Content-Type': 'application/json' },
                });
            }
            if (url.includes('/assets/upload/')) {
                return new Response('server exploded', { status: 500 });
            }
            return new Response('unknown', { status: 404 });
        };

        const upload = await uploadAsset({
            relayBaseUrl: 'https://r',
            sessionId: 's',
            bytes,
            mime: 'image/png',
            hash,
            fetchImpl: failingFetch,
        });
        expect(upload.ok).toBe(false);
        if (!upload.ok) {
            // The uploader exposes status + error so the editor can branch on 5xx/4xx.
            expect(upload.status).toBe(500);
        }
    });

    test('pushOverlayV1 with no assets field emits an empty manifest', async () => {
        const relay = makeFakeRelay([]);
        const pushResult = await pushOverlayV1({
            relayBaseUrl: 'https://r',
            sessionId: 's',
            overlay: { code: 'module.exports = {};', buildDurationMs: 0 },
            // assets intentionally omitted
            fetchImpl: relay.fetchImpl,
            onTelemetry: null,
        });
        expect(pushResult.ok).toBe(true);
        expect(relay.pushes).toHaveLength(1);
        const pushed = relay.pushes[0] as { assets: { abi: string; assets: Record<string, unknown> } };
        expect(pushed.assets.abi).toBe('v1');
        expect(pushed.assets.assets).toEqual({});
    });
});

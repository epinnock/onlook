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
});

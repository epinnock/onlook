import { describe, expect, test } from 'bun:test';
import type { AbiHelloMessage, RuntimeCapabilities } from '@onlook/mobile-client-protocol';

import { createReconnectReplayer } from '../reconnect-replayer';
import type { PushOverlayV1Options, PushOverlayResult } from '../push-overlay';

const baseCaps: RuntimeCapabilities = {
    abi: 'v1',
    baseHash: 'deadbeef',
    rnVersion: '0.81.6',
    expoSdk: '54.0.0',
    platform: 'ios',
    aliases: ['react'],
};

function phoneHello(): AbiHelloMessage {
    return {
        type: 'abiHello',
        abi: 'v1',
        sessionId: 's',
        role: 'phone',
        runtime: baseCaps,
    };
}

function editorHello(): AbiHelloMessage {
    return {
        type: 'abiHello',
        abi: 'v1',
        sessionId: 's',
        role: 'editor',
        runtime: baseCaps,
    };
}

describe('reconnect-replayer', () => {
    test('first-ever phone hello does not re-push', async () => {
        const calls: PushOverlayV1Options[] = [];
        const replayer = createReconnectReplayer({
            relayBaseUrl: 'https://r',
            sessionId: 's',
            latest: { code: 'x', buildDurationMs: 1 },
            push: async (opts) => {
                calls.push(opts);
                return { ok: true, delivered: 1, attempts: 1 } as PushOverlayResult;
            },
        });
        const result = await replayer.onAbiHello(phoneHello());
        expect(result).toBeNull();
        expect(calls).toHaveLength(0);
        expect(replayer.hasSeenPhoneHello).toBe(true);
    });

    test('second phone hello triggers a re-push of the latest overlay', async () => {
        const calls: PushOverlayV1Options[] = [];
        const replayer = createReconnectReplayer({
            relayBaseUrl: 'https://r',
            sessionId: 's',
            latest: { code: 'latest', buildDurationMs: 42, sourceMap: '{}' },
            push: async (opts) => {
                calls.push(opts);
                return { ok: true, delivered: 1, attempts: 1 };
            },
        });
        await replayer.onAbiHello(phoneHello()); // first — no push
        const result = await replayer.onAbiHello(phoneHello()); // reconnect
        expect(result?.ok).toBe(true);
        expect(calls).toHaveLength(1);
        expect(calls[0]!.overlay.code).toBe('latest');
        expect(calls[0]!.overlay.buildDurationMs).toBe(42);
    });

    test('editor hello does not trigger a re-push (only phone reconnects do)', async () => {
        const calls: PushOverlayV1Options[] = [];
        const replayer = createReconnectReplayer({
            relayBaseUrl: 'https://r',
            sessionId: 's',
            latest: { code: 'x', buildDurationMs: 1 },
            push: async (opts) => {
                calls.push(opts);
                return { ok: true, delivered: 1, attempts: 1 };
            },
        });
        await replayer.onAbiHello(editorHello());
        await replayer.onAbiHello(editorHello());
        expect(calls).toHaveLength(0);
    });

    test('reconnect with no latest overlay code returns null', async () => {
        const replayer = createReconnectReplayer({
            relayBaseUrl: 'https://r',
            sessionId: 's',
            latest: { code: null },
            push: async () => ({ ok: true, delivered: 1, attempts: 1 }),
        });
        await replayer.onAbiHello(phoneHello()); // first
        const result = await replayer.onAbiHello(phoneHello()); // reconnect
        expect(result).toBeNull();
    });

    test('latest is read by reference — mutations between first hello and reconnect are seen', async () => {
        const calls: PushOverlayV1Options[] = [];
        const latest = { code: 'v1-code', buildDurationMs: 10 };
        const replayer = createReconnectReplayer({
            relayBaseUrl: 'https://r',
            sessionId: 's',
            latest,
            push: async (opts) => {
                calls.push(opts);
                return { ok: true, delivered: 1, attempts: 1 };
            },
        });
        await replayer.onAbiHello(phoneHello());
        latest.code = 'v2-code-after-mutation';
        latest.buildDurationMs = 99;
        await replayer.onAbiHello(phoneHello());
        expect(calls[0]!.overlay.code).toBe('v2-code-after-mutation');
        expect(calls[0]!.overlay.buildDurationMs).toBe(99);
    });

    // ─── Extended coverage ──────────────────────────────────────────────────

    test('third and fourth phone hellos also trigger re-pushes (every reconnect re-pushes)', async () => {
        const calls: PushOverlayV1Options[] = [];
        const replayer = createReconnectReplayer({
            relayBaseUrl: 'https://r',
            sessionId: 's',
            latest: { code: 'x', buildDurationMs: 1 },
            push: async (opts) => {
                calls.push(opts);
                return { ok: true, delivered: 1, attempts: 1 };
            },
        });
        await replayer.onAbiHello(phoneHello()); // first — no push
        await replayer.onAbiHello(phoneHello()); // 2nd — push
        await replayer.onAbiHello(phoneHello()); // 3rd — push
        await replayer.onAbiHello(phoneHello()); // 4th — push
        expect(calls).toHaveLength(3);
    });

    test('push failure on reconnect surfaces via the result — does not wedge the replayer', async () => {
        const replayer = createReconnectReplayer({
            relayBaseUrl: 'https://r',
            sessionId: 's',
            latest: { code: 'x', buildDurationMs: 1 },
            push: async () => ({ ok: false, error: '503', attempts: 1 }),
        });
        await replayer.onAbiHello(phoneHello()); // first
        const result = await replayer.onAbiHello(phoneHello()); // reconnect
        expect(result?.ok).toBe(false);
        // hasSeenPhoneHello stays true — retrying later still triggers a push.
        expect(replayer.hasSeenPhoneHello).toBe(true);
    });

    test('latest.assets forwarded on reconnect push', async () => {
        const calls: PushOverlayV1Options[] = [];
        const replayer = createReconnectReplayer({
            relayBaseUrl: 'https://r',
            sessionId: 's',
            latest: {
                code: 'x',
                buildDurationMs: 1,
                assets: {
                    abi: 'v1',
                    assets: {
                        'image/abc': { kind: 'image', hash: 'abc', mime: 'image/png', uri: 'https://r/x' },
                    },
                },
            },
            push: async (opts) => {
                calls.push(opts);
                return { ok: true, delivered: 1, attempts: 1 };
            },
        });
        await replayer.onAbiHello(phoneHello()); // first
        await replayer.onAbiHello(phoneHello()); // reconnect
        expect(calls[0]!.assets).toBeDefined();
        expect(calls[0]!.assets!.assets['image/abc']).toBeDefined();
    });

    test('two replayers for different sessions maintain independent hasSeenPhoneHello state', async () => {
        const r1 = createReconnectReplayer({
            relayBaseUrl: 'https://r',
            sessionId: 'A',
            latest: { code: 'a' },
            push: async () => ({ ok: true, delivered: 1, attempts: 1 }),
        });
        const r2 = createReconnectReplayer({
            relayBaseUrl: 'https://r',
            sessionId: 'B',
            latest: { code: 'b' },
            push: async () => ({ ok: true, delivered: 1, attempts: 1 }),
        });
        expect(r1.hasSeenPhoneHello).toBe(false);
        expect(r2.hasSeenPhoneHello).toBe(false);
        await r1.onAbiHello(phoneHello());
        expect(r1.hasSeenPhoneHello).toBe(true);
        expect(r2.hasSeenPhoneHello).toBe(false); // independent
    });

    test('latest.buildDurationMs defaults to 0 when undefined', async () => {
        const calls: PushOverlayV1Options[] = [];
        const replayer = createReconnectReplayer({
            relayBaseUrl: 'https://r',
            sessionId: 's',
            latest: { code: 'x' }, // no buildDurationMs provided
            push: async (opts) => {
                calls.push(opts);
                return { ok: true, delivered: 1, attempts: 1 };
            },
        });
        await replayer.onAbiHello(phoneHello());
        await replayer.onAbiHello(phoneHello());
        expect(calls[0]!.overlay.buildDurationMs).toBe(0);
    });
});

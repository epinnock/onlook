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
});

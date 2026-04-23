/**
 * Composition test: `startEditorAbiHandshake` + `createReconnectReplayer`.
 *
 * Both modules are individually well-tested:
 *   - `abi-hello.test.ts` covers the handshake (editor sends, phone arrives,
 *     compatibility check fires).
 *   - `reconnect-replayer.test.ts` covers the replayer (first hello = no
 *     re-push, second+ = re-push of latest overlay).
 *
 * Neither is currently wired into `RelayWsClient` or any editor lifecycle
 * code, but the natural composition is:
 *
 *   const handshake = startEditorAbiHandshake({
 *     ws,
 *     sessionId,
 *     capabilities,
 *     onPhoneHello: (phone) => { replayer.onAbiHello(phone); },
 *   });
 *
 * This file locks that composition in with a wire-level test so
 * whoever wires it into production has a reference shape to match.
 */

import { describe, expect, test } from 'bun:test';

import type { AbiHelloMessage, RuntimeCapabilities } from '@onlook/mobile-client-protocol';

import type { PushOverlayResult, PushOverlayV1Options } from '../push-overlay';
import { startEditorAbiHandshake } from '../abi-hello';
import { createReconnectReplayer } from '../reconnect-replayer';

const baseCaps: RuntimeCapabilities = {
    abi: 'v1',
    baseHash: 'basehash',
    rnVersion: '0.81.6',
    expoSdk: '54.0.0',
    platform: 'ios',
    aliases: ['react', 'react-native'],
};

/**
 * Minimal WS-like harness: the handshake only needs `send` + message
 * `addEventListener`, so we simulate the two-way channel with an
 * injectable emitter and a sent-message log.
 */
function makeFakeWs() {
    const sent: string[] = [];
    type MessageListener = (event: { data: string }) => void;
    const listeners: MessageListener[] = [];
    return {
        sent,
        ws: {
            send(data: string) {
                sent.push(data);
            },
            addEventListener(type: 'message', listener: MessageListener) {
                if (type === 'message') listeners.push(listener);
            },
        },
        emit(message: AbiHelloMessage) {
            const data = JSON.stringify(message);
            for (const listener of listeners) listener({ data });
        },
    };
}

function phoneHello(sessionId = 's', caps = baseCaps): AbiHelloMessage {
    return {
        type: 'abiHello',
        abi: 'v1',
        sessionId,
        role: 'phone',
        runtime: caps,
    };
}

describe('abi-handshake + reconnect-replayer composition', () => {
    test('first phone hello: handshake records compatibility, replayer does NOT re-push', async () => {
        const { ws, emit, sent } = makeFakeWs();
        const pushes: PushOverlayV1Options[] = [];

        const replayer = createReconnectReplayer({
            relayBaseUrl: 'https://relay.example.com',
            sessionId: 's',
            latest: { code: 'bundle-code', buildDurationMs: 5 },
            push: async (opts) => {
                pushes.push(opts);
                return { ok: true, delivered: 1, attempts: 1 } as PushOverlayResult;
            },
        });

        const handshake = startEditorAbiHandshake({
            ws,
            sessionId: 's',
            capabilities: baseCaps,
            onPhoneHello: (phone) => {
                // Wire the replayer to the handshake.
                void replayer.onAbiHello(phone);
            },
        });

        // Editor sent its hello first.
        expect(sent.length).toBe(1);
        const editorHello = JSON.parse(sent[0]!);
        expect(editorHello.role).toBe('editor');

        // Phone hellos arrive.
        emit(phoneHello());
        // onAbiHello is async — drain the microtask queue so the replayer
        // observes the hello before we assert.
        await Promise.resolve();

        expect(handshake.compatibility()).toBe('ok');
        expect(replayer.hasSeenPhoneHello).toBe(true);
        expect(pushes).toHaveLength(0);
    });

    test('phone reconnect (second hello) triggers an editor re-push', async () => {
        const { ws, emit } = makeFakeWs();
        const pushes: PushOverlayV1Options[] = [];

        const replayer = createReconnectReplayer({
            relayBaseUrl: 'https://relay.example.com',
            sessionId: 's',
            latest: { code: 'latest-bundle', buildDurationMs: 42 },
            push: async (opts) => {
                pushes.push(opts);
                return { ok: true, delivered: 1, attempts: 1 } as PushOverlayResult;
            },
        });

        startEditorAbiHandshake({
            ws,
            sessionId: 's',
            capabilities: baseCaps,
            onPhoneHello: async (phone) => {
                await replayer.onAbiHello(phone);
            },
        });

        // First hello — initial join.
        emit(phoneHello());
        await Promise.resolve();
        expect(pushes).toHaveLength(0);

        // Phone disconnects + reconnects → second hello.
        emit(phoneHello());
        await Promise.resolve();
        await Promise.resolve(); // drain nested microtasks

        expect(pushes).toHaveLength(1);
        expect(pushes[0]!.overlay.code).toBe('latest-bundle');
        expect(pushes[0]!.overlay.buildDurationMs).toBe(42);
        expect(pushes[0]!.relayBaseUrl).toBe('https://relay.example.com');
        expect(pushes[0]!.sessionId).toBe('s');
    });

    test('second phone hello with no `latest.code` yet: no re-push (nothing to replay)', async () => {
        // If the editor hasn't produced an overlay before the phone
        // reconnects (unusual but possible — user scanning QR before any
        // edit), the replayer has nothing to replay. The fact that this
        // case doesn't throw / push an empty bundle is part of the
        // composition's safety contract.
        const { ws, emit } = makeFakeWs();
        const pushes: PushOverlayV1Options[] = [];

        const replayer = createReconnectReplayer({
            relayBaseUrl: 'https://relay.example.com',
            sessionId: 's',
            // `latest.code` starts null — mutated in place as the editor
            // builds overlays. The tests above mutate via the mock; here
            // we leave it null to simulate the pre-first-build case.
            latest: { code: null },
            push: async (opts) => {
                pushes.push(opts);
                return { ok: true, delivered: 1, attempts: 1 } as PushOverlayResult;
            },
        });

        startEditorAbiHandshake({
            ws,
            sessionId: 's',
            capabilities: baseCaps,
            onPhoneHello: async (phone) => {
                await replayer.onAbiHello(phone);
            },
        });

        emit(phoneHello());
        emit(phoneHello());
        await Promise.resolve();
        await Promise.resolve();

        expect(pushes).toHaveLength(0);
    });
});

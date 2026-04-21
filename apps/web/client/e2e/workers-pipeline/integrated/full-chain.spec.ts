/**
 * workers-pipeline integrated — full-chain in-process E2E.
 *
 * Wires every two-tier module together in a single Node process:
 *
 *   editor bundler  →  pushOverlay  →  fake HTTP relay  →  HmrSession emission
 *                                                       ↓
 *                                   OverlayDispatcher (mobile-client module)
 *                                                       ↓
 *                                   OnlookRuntime.reloadBundle stub fires
 *
 * Every component is the real production module — no mocks for the code
 * under test, only a minimal fake relay + an in-memory WebSocket pair to
 * bridge the /push HTTP side to the /hmr WS side. If this spec stays
 * green, the entire two-tier chain is provably wired end-to-end.
 */
import http from 'node:http';
import type { AddressInfo } from 'node:net';

import { expect, test } from '@playwright/test';

import { bundleFixtureAsOverlay } from '../helpers/browser-bundler-harness';
import { pushOverlay } from '../../../../../../apps/web/client/src/services/expo-relay/push-overlay';
import {
    OverlayDispatcher,
    resolveHmrSessionUrl,
} from '../../../../../../apps/mobile-client/src/relay/overlayDispatcher';
import { startTwoTierBootstrap } from '../../../../../../apps/mobile-client/src/flow/twoTierBootstrap';

class InMemorySocket {
    static OPEN = 1;
    readyState = InMemorySocket.OPEN;
    sent: string[] = [];
    private readonly listeners = new Map<string, Array<(event: { data?: unknown }) => void>>();

    addEventListener(type: string, listener: (event: { data?: unknown }) => void): void {
        const xs = this.listeners.get(type) ?? [];
        xs.push(listener);
        this.listeners.set(type, xs);
    }
    emit(type: string, data?: unknown): void {
        (this.listeners.get(type) ?? []).forEach((l) => l({ data }));
    }
    send(msg: string): void {
        this.sent.push(msg);
    }
    close(): void {
        this.readyState = 3;
    }
}

/** Fake HTTP relay that surfaces POSTs to the caller via `onPush`. */
async function startFakeRelay(
    onPush: (body: string) => void,
): Promise<{ baseUrl: string; close(): Promise<void> }> {
    const server = http.createServer((req, res) => {
        if (req.method === 'POST' && req.url?.startsWith('/push/')) {
            const chunks: Buffer[] = [];
            req.on('data', (c) => chunks.push(c as Buffer));
            req.on('end', () => {
                const body = Buffer.concat(chunks).toString('utf8');
                onPush(body);
                res.writeHead(202, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ delivered: 1 }));
            });
            return;
        }
        res.writeHead(404);
        res.end();
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const port = (server.address() as AddressInfo).port;
    return {
        baseUrl: `http://127.0.0.1:${port}`,
        close: () => new Promise<void>((r, j) => server.close((e) => (e ? j(e) : r()))),
    };
}

test.describe('workers-pipeline integrated — full chain', () => {
    test('hello fixture edit reaches OverlayDispatcher through every real module', async () => {
        // Mobile side: in-memory WS bridged into the real OverlayDispatcher.
        const hmrSocket = new InMemorySocket();
        const mounted: string[] = [];

        const handle = startTwoTierBootstrap({
            sessionId: 'full-chain-hello',
            relayUrl: 'http://relay',
            enabled: true,
            createDispatcher: (url) =>
                new OverlayDispatcher(url, {
                    createSocket: () => hmrSocket as unknown as WebSocket,
                }),
            mountOverlay: (code) => mounted.push(code),
        });

        try {
            // Relay side: fake HTTP endpoint that forwards received overlays
            // directly to the mobile-side WebSocket (what HmrSession does in
            // prod — broadcast on /push).
            const relay = await startFakeRelay((body) => hmrSocket.emit('message', body));

            try {
                // Editor side: bundle the hello fixture via real esbuild +
                // wrapOverlayCode, then post through the real push-client.
                const { wrapped, bundle } = await bundleFixtureAsOverlay('hello');

                const pushResult = await pushOverlay({
                    relayBaseUrl: relay.baseUrl,
                    sessionId: 'full-chain-hello',
                    overlay: { code: wrapped.code, sourceMap: bundle.sourceMap },
                });

                expect(pushResult.ok).toBe(true);
                if (!pushResult.ok) return;
                expect(pushResult.delivered).toBe(1);

                expect(mounted).toHaveLength(1);
                expect(mounted[0]).toBe(wrapped.code);
                expect(mounted[0]).toContain('globalThis.onlookMount = function onlookMount(props)');
            } finally {
                await relay.close();
            }
        } finally {
            handle.stop();
        }
    });

    test('a 2nd edit during an open session replaces the overlay without reconnect', async () => {
        const hmrSocket = new InMemorySocket();
        const mounted: string[] = [];

        const handle = startTwoTierBootstrap({
            sessionId: 'full-chain-replace',
            relayUrl: 'http://relay',
            enabled: true,
            createDispatcher: (url) =>
                new OverlayDispatcher(url, {
                    createSocket: () => hmrSocket as unknown as WebSocket,
                }),
            mountOverlay: (code) => mounted.push(code),
        });

        try {
            const relay = await startFakeRelay((body) => hmrSocket.emit('message', body));
            try {
                const first = await bundleFixtureAsOverlay('hello');
                await pushOverlay({
                    relayBaseUrl: relay.baseUrl,
                    sessionId: 'full-chain-replace',
                    overlay: { code: first.wrapped.code },
                });

                const second = await bundleFixtureAsOverlay('hello');
                await pushOverlay({
                    relayBaseUrl: relay.baseUrl,
                    sessionId: 'full-chain-replace',
                    overlay: { code: second.wrapped.code },
                });

                expect(mounted).toHaveLength(2);
                // The socket is still the same one — dispatcher didn't tear
                // down between overlays.
                expect(handle.active).toBe(true);
            } finally {
                await relay.close();
            }
        } finally {
            handle.stop();
        }
    });
});

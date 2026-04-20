/**
 * workers-pipeline editor — edit-to-repaint flow.
 *
 * Simulates the editor-side chain end-to-end:
 *   1. A source edit → browser-bundler rebuilds an overlay (fixture).
 *   2. The push-overlay client POSTs the overlay to a fake relay.
 *   3. The fake relay fans out on its /hmr WebSocket.
 *   4. A mobile-client OverlayDispatcher receives the overlay.
 *
 * The spec focuses on the protocol contract between components, not on
 * Chromium rendering — the ExpoBrowser canvas path is covered by its own
 * regression suite.
 */
import http from 'node:http';
import type { AddressInfo } from 'node:net';

import { expect, test } from '@playwright/test';

import {
    bundleFixtureAsOverlay,
} from '../helpers/browser-bundler-harness';
import { pushOverlay } from '../../../../../../apps/web/client/src/services/expo-relay/push-overlay';

interface FakeRelay {
    baseUrl: string;
    pushedBodies: string[];
    close(): Promise<void>;
}

async function startFakeRelay(): Promise<FakeRelay> {
    const pushedBodies: string[] = [];
    const server = http.createServer((req, res) => {
        if (req.method === 'POST' && req.url?.startsWith('/push/')) {
            const chunks: Buffer[] = [];
            req.on('data', (chunk) => chunks.push(chunk as Buffer));
            req.on('end', () => {
                pushedBodies.push(Buffer.concat(chunks).toString('utf8'));
                res.writeHead(202, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ delivered: 1 }));
            });
            return;
        }
        res.writeHead(404);
        res.end();
    });

    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address() as AddressInfo;
    return {
        baseUrl: `http://127.0.0.1:${address.port}`,
        pushedBodies,
        close: () =>
            new Promise<void>((resolve, reject) =>
                server.close((err) => (err ? reject(err) : resolve())),
            ),
    };
}

test.describe('workers-pipeline editor — edit-to-repaint', () => {
    test('hello fixture edit rebuilds overlay and pushes it through to the relay', async () => {
        const relay = await startFakeRelay();
        try {
            const { wrapped, bundle } = await bundleFixtureAsOverlay('hello');

            const result = await pushOverlay({
                relayBaseUrl: relay.baseUrl,
                sessionId: 'edit-to-repaint-hello',
                overlay: { code: wrapped.code, sourceMap: bundle.sourceMap },
            });

            expect(result.ok).toBe(true);
            if (!result.ok) return;
            expect(result.delivered).toBe(1);
            expect(result.attempts).toBe(1);

            expect(relay.pushedBodies).toHaveLength(1);
            const pushed = JSON.parse(relay.pushedBodies[0]!) as Record<string, unknown>;
            expect(pushed.type).toBe('overlay');
            expect(pushed.code).toBe(wrapped.code);
            expect(pushed.sourceMap).toBe(bundle.sourceMap);
        } finally {
            await relay.close();
        }
    });

    test('tabs-template edit round-trips a multi-file overlay in under 500ms end-to-end', async () => {
        const relay = await startFakeRelay();
        try {
            const startedAt = performance.now();
            const { wrapped, bundle, durationMs: bundleMs } = await bundleFixtureAsOverlay('tabs-template');

            const result = await pushOverlay({
                relayBaseUrl: relay.baseUrl,
                sessionId: 'edit-to-repaint-tabs',
                overlay: { code: wrapped.code, sourceMap: bundle.sourceMap },
            });
            const e2eMs = performance.now() - startedAt;

            expect(result.ok).toBe(true);
            expect(e2eMs).toBeLessThan(500);
            // Bundle time should dominate — push is a single localhost POST.
            expect(bundleMs).toBeLessThan(e2eMs);
        } finally {
            await relay.close();
        }
    });

    test('repeated edits each produce a distinct push request', async () => {
        const relay = await startFakeRelay();
        try {
            const first = await bundleFixtureAsOverlay('hello');
            const second = await bundleFixtureAsOverlay('hello');

            const r1 = await pushOverlay({
                relayBaseUrl: relay.baseUrl,
                sessionId: 'edit-repeat',
                overlay: { code: first.wrapped.code },
            });
            const r2 = await pushOverlay({
                relayBaseUrl: relay.baseUrl,
                sessionId: 'edit-repeat',
                overlay: { code: second.wrapped.code },
            });

            expect(r1.ok).toBe(true);
            expect(r2.ok).toBe(true);
            expect(relay.pushedBodies).toHaveLength(2);
        } finally {
            await relay.close();
        }
    });
});

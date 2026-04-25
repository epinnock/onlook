/**
 * Local verification script for the two-tier overlay flow (TS path only).
 *
 * Runs an in-process fake relay (HTTP /push + broadcast over a synthetic
 * WebSocket) and drives the OverlayDispatcher + twoTierBootstrap against
 * it. Validates: (a) a POSTed overlay reaches a connected dispatcher,
 * (b) the dispatcher delivers the code to the mount stub, (c) the
 * bootstrap tears down cleanly on stop.
 *
 * Run with:
 *   bun run apps/mobile-client/verification/two-tier-flow.ts
 *
 * Exits 0 on pass, 1 on fail. Does NOT require the iOS simulator or the
 * native OnlookRuntime binding — this is the leading indicator you can
 * run before the Xcode 16.1 device blocker lifts.
 */
import http from 'node:http';
import type { AddressInfo } from 'node:net';

import {
    OverlayDispatcher,
    resolveHmrSessionUrl,
} from '../src/relay/overlayDispatcher';
import { startTwoTierBootstrap } from '../src/flow/twoTierBootstrap';

class InMemorySocket {
    static OPEN = 1;
    readyState = InMemorySocket.OPEN;
    private readonly listeners = new Map<string, Array<(event: { data?: unknown }) => void>>();
    addEventListener(type: string, listener: (event: { data?: unknown }) => void): void {
        const xs = this.listeners.get(type) ?? [];
        xs.push(listener);
        this.listeners.set(type, xs);
    }
    emit(type: string, data?: unknown): void {
        (this.listeners.get(type) ?? []).forEach((l) => l({ data }));
    }
    close(): void {
        this.readyState = 3;
    }
}

async function main(): Promise<void> {
    const socket = new InMemorySocket();
    const mounted: string[] = [];

    // Fake relay that surfaces /push → socket.emit('message', body).
    const server = http.createServer((req, res) => {
        if (req.method === 'POST' && req.url?.startsWith('/push/')) {
            const chunks: Buffer[] = [];
            req.on('data', (c) => chunks.push(c as Buffer));
            req.on('end', () => {
                const body = Buffer.concat(chunks).toString('utf8');
                socket.emit('message', body);
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
    const relayBase = `http://127.0.0.1:${port}`;

    // Start the mobile bootstrap with the in-memory socket patched in.
    const handle = startTwoTierBootstrap({
        sessionId: 'verify-sess',
        relayUrl: relayBase,
        enabled: true,
        createDispatcher: (url) =>
            new OverlayDispatcher(url, {
                createSocket: () => socket as unknown as WebSocket,
            }),
        mountOverlay: (code) => mounted.push(code),
    });

    try {
        // Dispatch a fake overlay via the relay /push path. The fake relay
        // forwards to the in-memory WS listener, the dispatcher parses it,
        // the mount stub records it.
        const res = await fetch(`${relayBase}/push/verify-sess`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                type: 'overlay',
                code: 'globalThis.__onlookMountOverlay("verified");',
            }),
        });

        if (res.status !== 202) {
            throw new Error(`expected 202 from fake relay, got ${res.status}`);
        }

        if (mounted.length !== 1) {
            throw new Error(`expected 1 overlay mounted, got ${mounted.length}`);
        }
        if (!mounted[0]!.includes('__onlookMountOverlay("verified")')) {
            throw new Error(`mount payload mismatch: ${mounted[0]}`);
        }

        // Teardown should be clean.
        handle.stop();
        if (handle.active) {
            throw new Error('handle still active after stop()');
        }

        // eslint-disable-next-line no-console
        console.log('[verify] OK — two-tier TS flow reaches mount stub and tears down cleanly');
        process.exit(0);
    } catch (err) {
        // eslint-disable-next-line no-console
        console.error('[verify] FAIL —', err instanceof Error ? err.message : err);
        process.exit(1);
    } finally {
        await new Promise<void>((r) => server.close(() => r()));
    }
}

void main();

/**
 * Tests for the console streamer.
 *
 * Task: MC5.2
 * Validate: bun test apps/mobile-client/src/debug/__tests__/consoleStreamer.test.ts
 *
 * Installs the real {@link consoleRelay} singleton for the duration of each
 * test so emissions flow through the same path exercised in production, and
 * mocks the relay client with an `isConnected` flag + a `send` stub that can
 * be made to throw on demand.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import type { ConsoleMessage } from '@onlook/mobile-client-protocol';
import type { OnlookRelayClient, WsMessage } from '../../relay/wsClient';
import { consoleRelay } from '../consoleRelay';
import { ConsoleStreamer } from '../consoleStreamer';

// ── Test doubles ─────────────────────────────────────────────────────────────

/**
 * Mock `OnlookRelayClient`. Captures every `send` call into an array and
 * exposes an `isConnected` flag tests can toggle at will. `throwOnSend`
 * simulates the socket closing between the `isConnected` check and the write.
 */
class MockRelayClient {
    public sent: WsMessage[] = [];
    public isConnected = true;
    public throwOnSend = false;

    send(msg: WsMessage): void {
        if (this.throwOnSend) {
            throw new Error('WebSocket is not connected');
        }
        this.sent.push(msg);
    }
}

/** Cast the mock client to the public type the streamer expects. */
function asClient(mock: MockRelayClient): OnlookRelayClient {
    return mock as unknown as OnlookRelayClient;
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('ConsoleStreamer', () => {
    let client: MockRelayClient;
    let streamer: ConsoleStreamer;

    beforeEach(() => {
        client = new MockRelayClient();
        streamer = new ConsoleStreamer(asClient(client), 'sess-test');
        consoleRelay.install();
        consoleRelay.clearBuffer();
    });

    afterEach(() => {
        streamer.stop();
        consoleRelay.uninstall();
        consoleRelay.clearBuffer();
    });

    test('start() forwards subsequent console entries to the relay client', () => {
        streamer.start();

        console.log('hello world');

        expect(client.sent).toHaveLength(1);
        const msg = client.sent[0] as ConsoleMessage;
        expect(msg.type).toBe('onlook:console');
        expect(msg.sessionId).toBe('sess-test');
        expect(msg.level).toBe('log');
        expect(msg.args).toEqual(['hello world']);
        expect(typeof msg.timestamp).toBe('number');
    });

    test('stop() unsubscribes so later entries are not forwarded', () => {
        streamer.start();
        console.log('before-stop');
        expect(client.sent).toHaveLength(1);

        streamer.stop();
        console.warn('after-stop');
        console.error('also-after-stop');

        expect(client.sent).toHaveLength(1);
    });

    test('disconnected client buffers entries instead of sending', () => {
        client.isConnected = false;
        streamer.start();

        console.log('queued-1');
        console.warn('queued-2');
        console.error('queued-3');

        expect(client.sent).toHaveLength(0);
    });

    test('buffered entries flush on the next start() once reconnected', () => {
        // Phase 1 — running but socket is down; entries accumulate in the buffer.
        client.isConnected = false;
        streamer.start();
        console.log('queued-1');
        console.warn('queued-2');
        expect(client.sent).toHaveLength(0);

        // Phase 2 — app detects the disconnect and pauses the streamer.
        streamer.stop();

        // Phase 3 — reconnect + restart should drain the buffer in arrival order.
        client.isConnected = true;
        streamer.start();

        expect(client.sent).toHaveLength(2);
        const [first, second] = client.sent as ConsoleMessage[];
        expect(first?.args).toEqual(['queued-1']);
        expect(first?.level).toBe('log');
        expect(second?.args).toEqual(['queued-2']);
        expect(second?.level).toBe('warn');
    });

    test('send() throwing re-buffers the entry (connected-but-racing socket)', () => {
        client.throwOnSend = true;
        streamer.start();

        console.log('race-1');

        // `send` threw, so nothing landed on the wire.
        expect(client.sent).toHaveLength(0);

        // Restart with a healthy socket — the entry should now flush.
        streamer.stop();
        client.throwOnSend = false;
        streamer.start();

        expect(client.sent).toHaveLength(1);
        const msg = client.sent[0] as ConsoleMessage;
        expect(msg.args).toEqual(['race-1']);
    });
});

/**
 * Tests for ExceptionStreamer — exception catcher → onlook:error
 * forwarding. Mirrors consoleStreamer.test.ts in shape.
 */
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';

import type { ErrorMessage, WsMessage } from '@onlook/mobile-client-protocol';

import type { WsSenderHandle } from '../../relay/wsSender';
import { ExceptionCatcher } from '../exceptionCatcher';
import { ExceptionStreamer } from '../exceptionStreamer';

class FakeSender implements WsSenderHandle {
    public sent: WsMessage[] = [];
    public isConnected = true;
    public throwOnSend = false;
    send(msg: WsMessage): void {
        if (this.throwOnSend) {
            throw new Error('socket closed mid-write');
        }
        this.sent.push(msg);
    }
}

let catcher: ExceptionCatcher;
let sender: FakeSender;
let streamer: ExceptionStreamer;

beforeEach(() => {
    catcher = new ExceptionCatcher();
    sender = new FakeSender();
    streamer = new ExceptionStreamer(sender, 'sess-test', { catcher });
});

afterEach(() => {
    streamer.stop();
    catcher.uninstall?.();
});

describe('ExceptionStreamer', () => {
    test('forwards a captured JS exception as an onlook:error message', () => {
        streamer.start();
        const err = new Error('boom');
        catcher.captureException(err);
        expect(sender.sent).toHaveLength(1);
        const msg = sender.sent[0]! as ErrorMessage;
        expect(msg.type).toBe('onlook:error');
        expect(msg.sessionId).toBe('sess-test');
        expect(msg.kind).toBe('js');
        expect(msg.message).toBe('boom');
        expect(msg.stack).toBeDefined();
        expect(typeof msg.timestamp).toBe('number');
    });

    test('promotes kind to "react" when componentStack is present', () => {
        streamer.start();
        catcher.captureException(new Error('render-fail'), 'in <App>');
        const msg = sender.sent[0]! as ErrorMessage;
        expect(msg.kind).toBe('react');
    });

    test('buffers entries while disconnected, flushes on next captured exception once reconnected', () => {
        sender.isConnected = false;
        streamer.start();
        catcher.captureException(new Error('first'));
        catcher.captureException(new Error('second'));
        expect(sender.sent).toHaveLength(0);

        // Reconnect; the buffer drain happens lazily on the next forward.
        sender.isConnected = true;
        catcher.captureException(new Error('third'));
        const messages = sender.sent.map((m) => (m as ErrorMessage).message);
        expect(messages).toEqual(['third', 'first', 'second']);
    });

    test('falls back to buffering when send throws (socket closed mid-write)', () => {
        streamer.start();
        sender.throwOnSend = true;
        catcher.captureException(new Error('first'));
        expect(sender.sent).toHaveLength(0);

        sender.throwOnSend = false;
        catcher.captureException(new Error('second'));
        // The buffered first entry drains alongside the second.
        expect(sender.sent.length).toBeGreaterThanOrEqual(2);
    });

    test('setSessionId rotates the stamp without affecting the subscription', () => {
        streamer.start();
        catcher.captureException(new Error('pre-rotate'));
        streamer.setSessionId('sess-real');
        catcher.captureException(new Error('post-rotate'));
        const sessions = sender.sent.map((m) => (m as ErrorMessage).sessionId);
        expect(sessions).toEqual(['sess-test', 'sess-real']);
    });

    test('start is idempotent (subsequent calls are no-ops until stop)', () => {
        streamer.start();
        streamer.start();
        catcher.captureException(new Error('boom'));
        // If start() registered a second listener we'd see two messages.
        expect(sender.sent).toHaveLength(1);
    });

    test('stop unsubscribes — no further forwards after stop', () => {
        streamer.start();
        catcher.captureException(new Error('first'));
        streamer.stop();
        catcher.captureException(new Error('second'));
        expect(sender.sent).toHaveLength(1);
    });

    test('disconnected buffer caps at 50 entries (oldest dropped first)', () => {
        sender.isConnected = false;
        streamer.start();
        for (let i = 0; i < 60; i += 1) {
            catcher.captureException(new Error('e' + i));
        }
        // Reconnect + flush.
        sender.isConnected = true;
        catcher.captureException(new Error('flush-trigger'));
        // 50-entry cap + 1 flush trigger = 51 messages; oldest 10 dropped.
        expect(sender.sent.length).toBeLessThanOrEqual(51);
        const messages = sender.sent.map((m) => (m as ErrorMessage).message);
        expect(messages).not.toContain('e0');
        expect(messages).toContain('e10');
    });
});

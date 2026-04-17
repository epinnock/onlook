/**
 * Tests for the LiveReloadDispatcher.
 *
 * Task: MC3.14
 * Validate: bun test apps/mobile-client/src/relay/__tests__/liveReload.test.ts
 */

import { describe, expect, test } from 'bun:test';
import type { WsMessage } from '@onlook/mobile-client-protocol';
import { LiveReloadDispatcher } from '../liveReload';

// ── Fake relay client ───────────────────────────────────────────────────────

type MessageHandler = (msg: WsMessage) => void;

/**
 * Minimal mock of `OnlookRelayClient` — only the `onMessage` surface is
 * needed by `LiveReloadDispatcher`.
 */
class FakeRelayClient {
    private listeners = new Set<MessageHandler>();

    onMessage(handler: MessageHandler): () => void {
        this.listeners.add(handler);
        return () => {
            this.listeners.delete(handler);
        };
    }

    /** Test helper: push a message as if it came from the WebSocket. */
    emit(msg: WsMessage): void {
        for (const listener of this.listeners) {
            listener(msg);
        }
    }

    /** Test helper: current listener count. */
    get listenerCount(): number {
        return this.listeners.size;
    }
}

// ── Fixtures ────────────────────────────────────────────────────────────────

const BUNDLE_UPDATE_MSG: WsMessage = {
    type: 'bundleUpdate',
    sessionId: 'sess-abc-123',
    bundleUrl: 'https://relay.onlook.com/bundles/abc123.js',
    onlookRuntimeVersion: '0.1.0',
    timestamp: Date.now(),
};

const SECOND_BUNDLE_UPDATE_MSG: WsMessage = {
    type: 'bundleUpdate',
    sessionId: 'sess-abc-123',
    bundleUrl: 'https://relay.onlook.com/bundles/def456.js',
    onlookRuntimeVersion: '0.1.0',
    timestamp: Date.now(),
};

const CONSOLE_MSG: WsMessage = {
    type: 'onlook:console',
    sessionId: 'sess-abc-123',
    level: 'log',
    args: ['hello'],
    timestamp: Date.now(),
};

const SELECT_MSG: WsMessage = {
    type: 'onlook:select',
    sessionId: 'sess-abc-123',
    reactTag: 42,
    source: { fileName: 'App.tsx', lineNumber: 10, columnNumber: 4 },
};

const ERROR_MSG: WsMessage = {
    type: 'onlook:error',
    sessionId: 'sess-abc-123',
    kind: 'js',
    message: 'Something broke',
    timestamp: Date.now(),
};

// ── Tests ───────────────────────────────────────────────────────────────────

describe('LiveReloadDispatcher', () => {
    test('bundleUpdate message dispatches bundleUrl to reload handler', () => {
        const fake = new FakeRelayClient();
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const dispatcher = new LiveReloadDispatcher(fake as any);

        const received: string[] = [];
        dispatcher.onReload((url) => received.push(url));
        dispatcher.start();

        fake.emit(BUNDLE_UPDATE_MSG);

        expect(received).toHaveLength(1);
        expect(received[0]).toBe('https://relay.onlook.com/bundles/abc123.js');
    });

    test('non-bundleUpdate messages are ignored', () => {
        const fake = new FakeRelayClient();
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const dispatcher = new LiveReloadDispatcher(fake as any);

        const received: string[] = [];
        dispatcher.onReload((url) => received.push(url));
        dispatcher.start();

        fake.emit(CONSOLE_MSG);
        fake.emit(SELECT_MSG);
        fake.emit(ERROR_MSG);

        expect(received).toHaveLength(0);
    });

    test('stop() unsubscribes from the WS client so no further dispatches occur', () => {
        const fake = new FakeRelayClient();
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const dispatcher = new LiveReloadDispatcher(fake as any);

        const received: string[] = [];
        dispatcher.onReload((url) => received.push(url));
        dispatcher.start();

        fake.emit(BUNDLE_UPDATE_MSG);
        expect(received).toHaveLength(1);

        dispatcher.stop();

        // After stop, the fake client should have no listeners from the dispatcher.
        expect(fake.listenerCount).toBe(0);

        fake.emit(SECOND_BUNDLE_UPDATE_MSG);
        // No new dispatch — still 1.
        expect(received).toHaveLength(1);
    });

    test('multiple reload handlers all fire for a single bundleUpdate', () => {
        const fake = new FakeRelayClient();
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const dispatcher = new LiveReloadDispatcher(fake as any);

        const first: string[] = [];
        const second: string[] = [];
        const third: string[] = [];

        dispatcher.onReload((url) => first.push(url));
        dispatcher.onReload((url) => second.push(url));
        dispatcher.onReload((url) => third.push(url));
        dispatcher.start();

        fake.emit(BUNDLE_UPDATE_MSG);

        expect(first).toHaveLength(1);
        expect(second).toHaveLength(1);
        expect(third).toHaveLength(1);
        expect(first[0]).toBe(BUNDLE_UPDATE_MSG.bundleUrl);
        expect(second[0]).toBe(BUNDLE_UPDATE_MSG.bundleUrl);
        expect(third[0]).toBe(BUNDLE_UPDATE_MSG.bundleUrl);
    });

    test('onReload unsubscribe removes only the individual handler', () => {
        const fake = new FakeRelayClient();
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const dispatcher = new LiveReloadDispatcher(fake as any);

        const kept: string[] = [];
        const removed: string[] = [];

        dispatcher.onReload((url) => kept.push(url));
        const unsub = dispatcher.onReload((url) => removed.push(url));
        dispatcher.start();

        fake.emit(BUNDLE_UPDATE_MSG);
        expect(kept).toHaveLength(1);
        expect(removed).toHaveLength(1);

        // Unsubscribe only the second handler.
        unsub();

        fake.emit(SECOND_BUNDLE_UPDATE_MSG);
        expect(kept).toHaveLength(2);
        expect(removed).toHaveLength(1); // did not receive the second update
    });

    test('start() is idempotent — calling it twice does not duplicate dispatches', () => {
        const fake = new FakeRelayClient();
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const dispatcher = new LiveReloadDispatcher(fake as any);

        const received: string[] = [];
        dispatcher.onReload((url) => received.push(url));

        dispatcher.start();
        dispatcher.start(); // second call should be a no-op

        fake.emit(BUNDLE_UPDATE_MSG);

        // Should receive exactly 1, not 2.
        expect(received).toHaveLength(1);
        // Only one listener registered on the fake client.
        expect(fake.listenerCount).toBe(1);
    });

    test('start() after stop() resumes dispatching', () => {
        const fake = new FakeRelayClient();
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const dispatcher = new LiveReloadDispatcher(fake as any);

        const received: string[] = [];
        dispatcher.onReload((url) => received.push(url));

        dispatcher.start();
        fake.emit(BUNDLE_UPDATE_MSG);
        expect(received).toHaveLength(1);

        dispatcher.stop();
        fake.emit(SECOND_BUNDLE_UPDATE_MSG);
        expect(received).toHaveLength(1); // no dispatch while stopped

        dispatcher.start();
        fake.emit(BUNDLE_UPDATE_MSG);
        expect(received).toHaveLength(2); // dispatching resumes
    });
});

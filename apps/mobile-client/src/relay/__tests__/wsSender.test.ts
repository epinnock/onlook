/**
 * Tests for the wsSender registry — the bridge between AppRouter's
 * Spike B raw WS (production) and observability streamers
 * (ConsoleStreamer, etc.) that were originally typed against the
 * dead-on-arrival OnlookRelayClient.
 */
import { afterEach, describe, expect, test } from 'bun:test';

import type { WsMessage } from '@onlook/mobile-client-protocol';

import {
    __resetActiveWsSenderForTests,
    dynamicWsSender,
    getActiveWsSender,
    registerActiveWsSender,
    unregisterActiveWsSender,
    type WsSenderHandle,
} from '../wsSender';

interface FakeSender extends WsSenderHandle {
    sent: WsMessage[];
    isConnected: boolean;
}

function makeFakeSender(initiallyConnected = true): FakeSender {
    const sent: WsMessage[] = [];
    return {
        sent,
        isConnected: initiallyConnected,
        send(msg) {
            sent.push(msg);
        },
    };
}

afterEach(() => {
    __resetActiveWsSenderForTests();
});

describe('wsSender registry', () => {
    test('getActiveWsSender returns null when nothing is registered', () => {
        expect(getActiveWsSender()).toBeNull();
    });

    test('registerActiveWsSender stores the handle for retrieval', () => {
        const sender = makeFakeSender();
        registerActiveWsSender(sender);
        expect(getActiveWsSender()).toBe(sender);
    });

    test('a second register replaces the first (most-recent-wins)', () => {
        const a = makeFakeSender();
        const b = makeFakeSender();
        registerActiveWsSender(a);
        registerActiveWsSender(b);
        expect(getActiveWsSender()).toBe(b);
    });

    test('unregisterActiveWsSender clears the handle', () => {
        registerActiveWsSender(makeFakeSender());
        unregisterActiveWsSender();
        expect(getActiveWsSender()).toBeNull();
    });

    test('unregisterActiveWsSender is idempotent (safe to call twice)', () => {
        registerActiveWsSender(makeFakeSender());
        unregisterActiveWsSender();
        unregisterActiveWsSender();
        expect(getActiveWsSender()).toBeNull();
    });
});

describe('dynamicWsSender', () => {
    test('isConnected returns false when nothing is registered', () => {
        expect(dynamicWsSender.isConnected).toBe(false);
    });

    test('isConnected reflects the registered sender', () => {
        const s = makeFakeSender(true);
        registerActiveWsSender(s);
        expect(dynamicWsSender.isConnected).toBe(true);
        s.isConnected = false;
        expect(dynamicWsSender.isConnected).toBe(false);
    });

    test('send throws when no sender is registered', () => {
        expect(() =>
            dynamicWsSender.send({
                type: 'onlook:console',
                sessionId: 'sess',
                level: 'log',
                args: ['hello'],
                timestamp: 0,
            }),
        ).toThrow('no active sender');
    });

    test('send delegates to the registered handle', () => {
        const s = makeFakeSender();
        registerActiveWsSender(s);
        const msg: WsMessage = {
            type: 'onlook:console',
            sessionId: 'sess',
            level: 'log',
            args: ['hello'],
            timestamp: 0,
        };
        dynamicWsSender.send(msg);
        expect(s.sent).toEqual([msg]);
    });

    test('send delegates to the LATEST registered sender after replacement', () => {
        const a = makeFakeSender();
        const b = makeFakeSender();
        registerActiveWsSender(a);
        registerActiveWsSender(b);
        const msg: WsMessage = {
            type: 'onlook:console',
            sessionId: 'sess',
            level: 'log',
            args: ['x'],
            timestamp: 0,
        };
        dynamicWsSender.send(msg);
        expect(a.sent).toEqual([]);
        expect(b.sent).toEqual([msg]);
    });

    test('send throws after unregister even if a handle was previously active', () => {
        registerActiveWsSender(makeFakeSender());
        unregisterActiveWsSender();
        expect(() =>
            dynamicWsSender.send({
                type: 'onlook:console',
                sessionId: 'sess',
                level: 'log',
                args: ['x'],
                timestamp: 0,
            }),
        ).toThrow('no active sender');
    });
});

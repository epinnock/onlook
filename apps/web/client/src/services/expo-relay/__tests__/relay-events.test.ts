import { describe, expect, test } from 'bun:test';
import type { ConsoleMessage, ErrorMessage } from '@onlook/mobile-client-protocol';

import { subscribeRelayEvents } from '../relay-events';

class FakeWs {
    private listeners: Array<(e: { data: string }) => void> = [];
    addEventListener(_type: 'message', l: (e: { data: string }) => void): void {
        this.listeners.push(l);
    }
    removeEventListener(_type: 'message', l: (e: { data: string }) => void): void {
        this.listeners = this.listeners.filter((x) => x !== l);
    }
    emit(data: unknown): void {
        const raw = typeof data === 'string' ? data : JSON.stringify(data);
        for (const l of this.listeners) l({ data: raw });
    }
    get listenerCount(): number {
        return this.listeners.length;
    }
}

describe('relay-events / subscribeRelayEvents', () => {
    test('routes onlook:console to onConsole', () => {
        const ws = new FakeWs();
        const seen: ConsoleMessage[] = [];
        subscribeRelayEvents({
            ws,
            handlers: { onConsole: (m) => seen.push(m) },
        });
        const msg: ConsoleMessage = {
            type: 'onlook:console',
            sessionId: 's',
            level: 'log',
            args: ['hi'],
            timestamp: 1,
        };
        ws.emit(msg);
        expect(seen).toEqual([msg]);
    });

    test('routes onlook:error to onError AND fires onAny', () => {
        const ws = new FakeWs();
        const errs: ErrorMessage[] = [];
        const anys: unknown[] = [];
        subscribeRelayEvents({
            ws,
            handlers: {
                onError: (m) => errs.push(m),
                onAny: (m) => anys.push(m),
            },
        });
        const msg: ErrorMessage = {
            type: 'onlook:error',
            sessionId: 's',
            kind: 'js',
            message: 'boom',
            timestamp: 1,
        };
        ws.emit(msg);
        expect(errs).toEqual([msg]);
        expect(anys).toEqual([msg]);
    });

    test('cancel() removes the WS listener', () => {
        const ws = new FakeWs();
        const seen: unknown[] = [];
        const sub = subscribeRelayEvents({
            ws,
            handlers: { onConsole: (m) => seen.push(m) },
        });
        expect(ws.listenerCount).toBe(1);
        sub.cancel();
        expect(ws.listenerCount).toBe(0);
        ws.emit({
            type: 'onlook:console',
            sessionId: 's',
            level: 'log',
            args: [],
            timestamp: 1,
        });
        expect(seen).toEqual([]);
    });

    test('non-onlook:* messages (e.g. overlayUpdate) are silently ignored', () => {
        const ws = new FakeWs();
        const seen: unknown[] = [];
        const unhandled: unknown[] = [];
        subscribeRelayEvents({
            ws,
            handlers: {
                onAny: (m) => seen.push(m),
                onUnhandled: (m) => unhandled.push(m),
            },
        });
        ws.emit({
            type: 'overlayUpdate',
            abi: 'v1',
            sessionId: 's',
            source: 'x',
            assets: { abi: 'v1', assets: {} },
            meta: { overlayHash: 'h', entryModule: 0, buildDurationMs: 0 },
        });
        expect(seen).toEqual([]);
        expect(unhandled).toEqual([]);
    });

    test('malformed onlook:* JSON calls onMalformed', () => {
        const ws = new FakeWs();
        const malformed: string[] = [];
        subscribeRelayEvents({
            ws,
            handlers: { onMalformed: (raw) => malformed.push(raw) },
        });
        ws.emit('{"type":"onlook:error","oops-missing-fields":true}');
        expect(malformed).toHaveLength(1);
    });

    test('routes onlook:overlayAck to onOverlayAck and fires onAny — task #61', () => {
        const ws = new FakeWs();
        const acks: unknown[] = [];
        const anys: unknown[] = [];
        subscribeRelayEvents({
            ws,
            handlers: {
                onOverlayAck: (m) => acks.push(m),
                onAny: (m) => anys.push(m),
            },
        });
        const ack = {
            type: 'onlook:overlayAck',
            sessionId: 's',
            overlayHash: 'h'.repeat(64),
            status: 'mounted',
            timestamp: 1,
        };
        ws.emit(ack);
        expect(acks).toEqual([ack]);
        expect(anys).toEqual([ack]);
    });

    test('multiple subscribers stack without interfering', () => {
        const ws = new FakeWs();
        const a: unknown[] = [];
        const b: unknown[] = [];
        subscribeRelayEvents({ ws, handlers: { onConsole: (m) => a.push(m) } });
        subscribeRelayEvents({ ws, handlers: { onConsole: (m) => b.push(m) } });
        ws.emit({
            type: 'onlook:console',
            sessionId: 's',
            level: 'log',
            args: [],
            timestamp: 1,
        });
        expect(a).toHaveLength(1);
        expect(b).toHaveLength(1);
    });
});

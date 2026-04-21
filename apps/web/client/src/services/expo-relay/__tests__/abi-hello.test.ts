import { describe, expect, test } from 'bun:test';
import type { RuntimeCapabilities } from '@onlook/mobile-client-protocol';

import { buildEditorAbiHello, startEditorAbiHandshake } from '../abi-hello';

const baseCaps: RuntimeCapabilities = {
    abi: 'v1',
    baseHash: 'deadbeef',
    rnVersion: '0.81.6',
    expoSdk: '54.0.0',
    platform: 'ios',
    aliases: ['react', 'react-native'],
};

class FakeWs {
    sent: string[] = [];
    private listener: ((e: { data: string }) => void) | null = null;
    send(data: string): void {
        this.sent.push(data);
    }
    addEventListener(_type: 'message', l: (e: { data: string }) => void): void {
        this.listener = l;
    }
    emit(data: unknown): void {
        this.listener?.({ data: typeof data === 'string' ? data : JSON.stringify(data) });
    }
}

describe('abi-hello', () => {
    test('buildEditorAbiHello produces a valid AbiHelloMessage', () => {
        const msg = buildEditorAbiHello({ sessionId: 's', capabilities: baseCaps });
        expect(msg.type).toBe('abiHello');
        expect(msg.abi).toBe('v1');
        expect(msg.role).toBe('editor');
        expect(msg.runtime).toEqual(baseCaps);
    });

    test('startEditorAbiHandshake sends hello immediately and awaits phone hello', () => {
        const ws = new FakeWs();
        const seen: unknown[] = [];
        const handle = startEditorAbiHandshake({
            ws,
            sessionId: 's',
            capabilities: baseCaps,
            onPhoneHello: (p) => seen.push(p),
        });

        expect(ws.sent).toHaveLength(1);
        const sent = JSON.parse(ws.sent[0]!);
        expect(sent.type).toBe('abiHello');
        expect(sent.role).toBe('editor');
        expect(handle.compatibility()).toBe('unknown');

        const phoneHello = {
            type: 'abiHello',
            abi: 'v1',
            sessionId: 's',
            role: 'phone',
            runtime: baseCaps,
        };
        ws.emit(phoneHello);
        expect(seen).toEqual([phoneHello]);
        expect(handle.compatibility()).toBe('ok');
    });

    test('startEditorAbiHandshake reports incompatibility when phone advertises a different abi', () => {
        const ws = new FakeWs();
        const incompatible: { kind?: string } | null = { kind: undefined };
        const handle = startEditorAbiHandshake({
            ws,
            sessionId: 's',
            capabilities: baseCaps,
            onPhoneHello: () => {},
            onIncompatible: (err) => {
                incompatible.kind = err.kind;
            },
        });
        ws.emit({
            type: 'abiHello',
            abi: 'v1',
            sessionId: 's',
            role: 'phone',
            runtime: { ...baseCaps, abi: 'v0' },
        });
        expect(incompatible.kind).toBe('abi-mismatch');
        expect(handle.compatibility()).not.toBe('ok');
    });

    test('non-phone messages are ignored', () => {
        const ws = new FakeWs();
        const seen: unknown[] = [];
        const handle = startEditorAbiHandshake({
            ws,
            sessionId: 's',
            capabilities: baseCaps,
            onPhoneHello: (p) => seen.push(p),
        });
        ws.emit({ type: 'something-else' });
        ws.emit({
            type: 'abiHello',
            abi: 'v1',
            sessionId: 's',
            role: 'editor',
            runtime: baseCaps,
        });
        expect(seen).toHaveLength(0);
        expect(handle.compatibility()).toBe('unknown');
    });

    test('handle.cancel() stops processing further messages', () => {
        const ws = new FakeWs();
        const seen: unknown[] = [];
        const handle = startEditorAbiHandshake({
            ws,
            sessionId: 's',
            capabilities: baseCaps,
            onPhoneHello: (p) => seen.push(p),
        });
        handle.cancel();
        ws.emit({
            type: 'abiHello',
            abi: 'v1',
            sessionId: 's',
            role: 'phone',
            runtime: baseCaps,
        });
        expect(seen).toHaveLength(0);
    });
});

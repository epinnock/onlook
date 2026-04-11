import { describe, expect, test } from 'bun:test';
import {
    assertNeverMessage,
    WsMessageSchema,
    type WsMessage,
} from './ws-messages.ts';

describe('WsMessageSchema', () => {
    test('parses a bundleUpdate message', () => {
        const parsed = WsMessageSchema.parse({
            type: 'bundleUpdate',
            sessionId: 'abc',
            bundleUrl: 'https://relay.onlook.com/bundle/abc',
            onlookRuntimeVersion: '0.1.0',
            timestamp: 1_744_934_400_000,
        });
        expect(parsed.type).toBe('bundleUpdate');
    });

    test('parses an onlook:select message with source location', () => {
        const parsed = WsMessageSchema.parse({
            type: 'onlook:select',
            sessionId: 'abc',
            reactTag: 42,
            source: { fileName: 'App.tsx', lineNumber: 12, columnNumber: 8 },
        });
        expect(parsed.type).toBe('onlook:select');
        if (parsed.type !== 'onlook:select') throw new Error('narrow');
        expect(parsed.source.fileName).toBe('App.tsx');
        expect(parsed.source.lineNumber).toBe(12);
    });

    test('parses an onlook:console message with stringified args', () => {
        const parsed = WsMessageSchema.parse({
            type: 'onlook:console',
            sessionId: 'abc',
            level: 'warn',
            args: ['deprecation notice', JSON.stringify({ api: 'old' })],
            timestamp: 0,
        });
        expect(parsed.type).toBe('onlook:console');
        if (parsed.type !== 'onlook:console') throw new Error('narrow');
        expect(parsed.args).toHaveLength(2);
        expect(parsed.level).toBe('warn');
    });

    test('parses onlook:network (end phase) with status', () => {
        const parsed = WsMessageSchema.parse({
            type: 'onlook:network',
            sessionId: 'abc',
            requestId: 'req-1',
            method: 'GET',
            url: 'https://api.onlook.com/foo',
            status: 200,
            durationMs: 42,
            phase: 'end',
            timestamp: 0,
        });
        if (parsed.type !== 'onlook:network') throw new Error('narrow');
        expect(parsed.phase).toBe('end');
        expect(parsed.status).toBe(200);
    });

    test('parses onlook:error with kind + optional source', () => {
        const parsed = WsMessageSchema.parse({
            type: 'onlook:error',
            sessionId: 'abc',
            kind: 'react',
            message: 'Cannot read property of undefined',
            source: { fileName: 'Button.tsx', lineNumber: 3, columnNumber: 0 },
            timestamp: 0,
        });
        if (parsed.type !== 'onlook:error') throw new Error('narrow');
        expect(parsed.kind).toBe('react');
    });

    test('rejects message with unknown `type`', () => {
        expect(() =>
            WsMessageSchema.parse({ type: 'onlook:unknown', sessionId: 'abc' }),
        ).toThrow();
    });

    test('assertNeverMessage is a compile-time exhaustiveness helper', () => {
        // Runtime path: calling it with a real value throws.
        const fakeMsg = { type: 'bogus' } as unknown as never;
        expect(() => assertNeverMessage(fakeMsg)).toThrow();
    });

    test('switch statement over WsMessage is exhaustive (type-level)', () => {
        // This test exists to pin the exhaustiveness invariant — if a new variant
        // is added to WsMessage without updating this switch, tsc will error on
        // the assertNeverMessage(_) call below.
        function describe_(msg: WsMessage): string {
            switch (msg.type) {
                case 'bundleUpdate':
                    return 'update';
                case 'onlook:select':
                    return 'select';
                case 'onlook:console':
                    return 'console';
                case 'onlook:network':
                    return 'network';
                case 'onlook:error':
                    return 'error';
                default:
                    return assertNeverMessage(msg);
            }
        }
        expect(
            describe_({
                type: 'bundleUpdate',
                sessionId: 'abc',
                bundleUrl: 'https://relay.onlook.com/bundle/abc',
                onlookRuntimeVersion: '0.1.0',
                timestamp: 0,
            }),
        ).toBe('update');
    });
});

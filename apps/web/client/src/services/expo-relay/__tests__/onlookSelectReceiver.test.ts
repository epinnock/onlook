/**
 * Tests for the MC4.15 editor-side receiver.
 *
 * We test the public surface only: registration, dispatch, unsubscribe,
 * and malformed-message handling. The `__resetOnlookSelectReceiverForTests`
 * hook keeps each case isolated from its predecessor.
 */

import { afterEach, describe, expect, test } from 'bun:test';

import {
    __resetOnlookSelectReceiverForTests,
    dispatchOnlookSelect,
    normalizeOnlookSelect,
    registerOnlookSelectHandler,
    type OnlookSelectMessage,
} from '../onlookSelectReceiver';

afterEach(() => {
    __resetOnlookSelectReceiverForTests();
});

/** Minimal wire-format message matching the MC4.14 `SelectMessage` shape. */
function makeWireMessage(
    overrides: Partial<{
        fileName: string;
        lineNumber: number;
        columnNumber: number;
        sessionId: string;
        reactTag: number;
        timestamp: number;
    }> = {},
): Record<string, unknown> {
    return {
        type: 'onlook:select',
        sessionId: overrides.sessionId ?? 'sess-1',
        reactTag: overrides.reactTag ?? 42,
        source: {
            fileName: overrides.fileName ?? 'apps/web/client/src/app/page.tsx',
            lineNumber: overrides.lineNumber ?? 12,
            columnNumber: overrides.columnNumber ?? 8,
        },
        timestamp: overrides.timestamp ?? 1_712_000_000_000,
    };
}

describe('normalizeOnlookSelect', () => {
    test('accepts the wire format (nested `source`) and flattens it', () => {
        const normalized = normalizeOnlookSelect(makeWireMessage());
        expect(normalized).not.toBeNull();
        expect(normalized?.type).toBe('onlook:select');
        expect(normalized?.fileName).toBe('apps/web/client/src/app/page.tsx');
        expect(normalized?.lineNumber).toBe(12);
        expect(normalized?.columnNumber).toBe(8);
        // Wire-format numeric timestamp is converted to ISO-8601.
        expect(normalized?.timestamp).toBe(
            new Date(1_712_000_000_000).toISOString(),
        );
    });

    test('accepts the already-flat editor format', () => {
        const flat: OnlookSelectMessage = {
            type: 'onlook:select',
            fileName: 'App.tsx',
            lineNumber: 1,
            columnNumber: 0,
            timestamp: '2026-04-11T00:00:00.000Z',
        };
        const normalized = normalizeOnlookSelect(flat);
        expect(normalized).toEqual(flat);
    });

    test('synthesizes a timestamp when one is missing', () => {
        const raw: Record<string, unknown> = {
            type: 'onlook:select',
            source: { fileName: 'a.tsx', lineNumber: 2, columnNumber: 3 },
        };
        const normalized = normalizeOnlookSelect(raw);
        expect(normalized).not.toBeNull();
        // ISO-8601 Zulu format check.
        expect(normalized?.timestamp).toMatch(
            /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/,
        );
    });

    test.each([
        ['null', null],
        ['undefined', undefined],
        ['non-object (string)', 'onlook:select'],
        ['non-object (number)', 42],
        ['wrong type discriminator', { type: 'onlook:console', source: { fileName: 'a.tsx', lineNumber: 1, columnNumber: 0 } }],
        ['missing source entirely', { type: 'onlook:select' }],
        ['empty fileName', makeWireMessage({ fileName: '' })],
        ['non-positive lineNumber', makeWireMessage({ lineNumber: 0 })],
        ['negative columnNumber', makeWireMessage({ columnNumber: -1 })],
        ['NaN lineNumber', makeWireMessage({ lineNumber: Number.NaN })],
    ])('rejects malformed payload: %s', (_label, raw) => {
        expect(normalizeOnlookSelect(raw)).toBeNull();
    });
});

describe('registerOnlookSelectHandler + dispatchOnlookSelect', () => {
    test('registered handler fires on dispatch with the normalized payload', () => {
        const received: OnlookSelectMessage[] = [];
        registerOnlookSelectHandler((msg) => received.push(msg));

        const ok = dispatchOnlookSelect(makeWireMessage());
        expect(ok).toBe(true);
        expect(received).toHaveLength(1);
        expect(received[0]).toEqual({
            type: 'onlook:select',
            fileName: 'apps/web/client/src/app/page.tsx',
            lineNumber: 12,
            columnNumber: 8,
            timestamp: new Date(1_712_000_000_000).toISOString(),
        });
    });

    test('multiple handlers all fire, in registration order', () => {
        const order: number[] = [];
        registerOnlookSelectHandler(() => order.push(1));
        registerOnlookSelectHandler(() => order.push(2));
        registerOnlookSelectHandler(() => order.push(3));

        dispatchOnlookSelect(makeWireMessage());
        expect(order).toEqual([1, 2, 3]);
    });

    test('unsubscribe stops future delivery to that handler only', () => {
        const kept: OnlookSelectMessage[] = [];
        const dropped: OnlookSelectMessage[] = [];
        registerOnlookSelectHandler((msg) => kept.push(msg));
        const unsubscribe = registerOnlookSelectHandler((msg) => dropped.push(msg));

        dispatchOnlookSelect(makeWireMessage({ fileName: 'first.tsx' }));
        unsubscribe();
        dispatchOnlookSelect(makeWireMessage({ fileName: 'second.tsx' }));

        expect(kept.map((m) => m.fileName)).toEqual(['first.tsx', 'second.tsx']);
        expect(dropped.map((m) => m.fileName)).toEqual(['first.tsx']);
    });

    test('unsubscribe is idempotent', () => {
        const received: OnlookSelectMessage[] = [];
        const unsubscribe = registerOnlookSelectHandler((msg) => received.push(msg));

        unsubscribe();
        unsubscribe(); // second call must not throw or re-remove
        dispatchOnlookSelect(makeWireMessage());

        expect(received).toHaveLength(0);
    });

    test('malformed dispatches are dropped silently and reported via onInvalid', () => {
        const received: OnlookSelectMessage[] = [];
        const invalidSeen: unknown[] = [];
        registerOnlookSelectHandler((msg) => received.push(msg));

        const okBad = dispatchOnlookSelect(
            { type: 'onlook:console' },
            { onInvalid: (raw) => invalidSeen.push(raw) },
        );
        const okNull = dispatchOnlookSelect(null, {
            onInvalid: (raw) => invalidSeen.push(raw),
        });

        expect(okBad).toBe(false);
        expect(okNull).toBe(false);
        expect(received).toHaveLength(0);
        expect(invalidSeen).toHaveLength(2);
    });

    test('handler receives payload for flat-format dispatch too', () => {
        const received: OnlookSelectMessage[] = [];
        registerOnlookSelectHandler((msg) => received.push(msg));

        const flat: OnlookSelectMessage = {
            type: 'onlook:select',
            fileName: 'Button.tsx',
            lineNumber: 7,
            columnNumber: 2,
            timestamp: '2026-04-11T10:00:00.000Z',
        };
        const ok = dispatchOnlookSelect(flat);

        expect(ok).toBe(true);
        expect(received).toEqual([flat]);
    });
});

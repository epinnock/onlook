/**
 * MobileDevPanel tests — focus on the pure helpers (`deriveAckCount`,
 * `derivePreflightIssueCount`) since the Tabs render path pulls in
 * `@radix-ui/react-tabs` which isn't server-renderable in isolation.
 * Runtime rendering is covered by the sibling tab tests + the future
 * Playwright flow that exercises the actual editor panel.
 */

import { describe, expect, test } from 'bun:test';

import type {
    ConsoleMessage,
    OverlayAckMessage,
    WsMessage,
} from '@onlook/mobile-client-protocol';

import { formatPreflightSummary } from '@/services/expo-relay/preflight-formatter';

import {
    deriveAckCount,
    deriveAckOverBudgetCount,
    derivePreflightIssueCount,
} from '../MobileDevPanel';

function makeAck(overrides: Partial<OverlayAckMessage> = {}): OverlayAckMessage {
    return {
        type: 'onlook:overlayAck',
        sessionId: 'sess-1',
        overlayHash: 'h',
        status: 'mounted',
        timestamp: 1,
        ...overrides,
    };
}

function makeConsole(sessionId = 'sess-1'): ConsoleMessage {
    return {
        type: 'onlook:console',
        sessionId,
        level: 'log',
        args: ['hi'],
        timestamp: 1,
    };
}

describe('deriveAckCount', () => {
    test('uses the explicit ack buffer when provided and no session filter', () => {
        const acks = [makeAck(), makeAck({ sessionId: 'sess-2' })];
        expect(deriveAckCount([], acks)).toBe(2);
    });

    test('filters explicit ack buffer by sessionId when supplied', () => {
        const acks = [makeAck(), makeAck({ sessionId: 'sess-2' })];
        expect(deriveAckCount([], acks, 'sess-1')).toBe(1);
        expect(deriveAckCount([], acks, 'sess-missing')).toBe(0);
    });

    test('derives count from messages stream when acks buffer is omitted', () => {
        const stream: WsMessage[] = [
            makeConsole(),
            makeAck() as unknown as WsMessage,
            makeConsole(),
            makeAck({ sessionId: 'sess-2' }) as unknown as WsMessage,
        ];
        expect(deriveAckCount(stream, undefined)).toBe(2);
        expect(deriveAckCount(stream, undefined, 'sess-1')).toBe(1);
    });

    test('returns 0 when no acks in either source', () => {
        expect(deriveAckCount([], undefined)).toBe(0);
        expect(deriveAckCount([makeConsole()], [])).toBe(0);
    });
});

describe('derivePreflightIssueCount', () => {
    test('returns 0 for null summary', () => {
        expect(derivePreflightIssueCount(null)).toBe(0);
    });

    test('sums unsupported-native + unknown-specifier counts', () => {
        const summary = formatPreflightSummary([
            { kind: 'unsupported-native', specifier: 'a', filePath: 'f1', message: 'native a' },
            { kind: 'unknown-specifier', specifier: 'b', filePath: 'f2', message: 'unknown b' },
            { kind: 'unsupported-native', specifier: 'c', filePath: 'f3', message: 'native c' },
        ]);
        expect(derivePreflightIssueCount(summary)).toBe(3);
    });

    test('single issue returns 1', () => {
        const summary = formatPreflightSummary([
            { kind: 'unsupported-native', specifier: 'a', filePath: 'f', message: 'native a' },
        ]);
        expect(derivePreflightIssueCount(summary)).toBe(1);
    });
});

describe('deriveAckOverBudgetCount', () => {
    test('returns 0 when no ack has mountDurationMs', () => {
        expect(
            deriveAckOverBudgetCount([], [makeAck(), makeAck()]),
        ).toBe(0);
    });

    test('counts acks whose mountDurationMs > 100ms', () => {
        const acks = [
            makeAck({ mountDurationMs: 50 }),
            makeAck({ mountDurationMs: 150 }),
            makeAck({ mountDurationMs: 200 }),
            makeAck(),
        ];
        expect(deriveAckOverBudgetCount([], acks)).toBe(2);
    });

    test('respects sessionId filter', () => {
        const acks = [
            makeAck({ sessionId: 'sess-1', mountDurationMs: 150 }),
            makeAck({ sessionId: 'sess-2', mountDurationMs: 250 }),
        ];
        expect(deriveAckOverBudgetCount([], acks, 'sess-1')).toBe(1);
        expect(deriveAckOverBudgetCount([], acks, 'sess-2')).toBe(1);
        expect(deriveAckOverBudgetCount([], acks)).toBe(2);
    });

    test('derives from messages stream when acks buffer is omitted', () => {
        const stream: WsMessage[] = [
            makeConsole(),
            makeAck({ mountDurationMs: 200 }) as unknown as WsMessage,
            makeAck({ mountDurationMs: 50 }) as unknown as WsMessage,
        ];
        expect(deriveAckOverBudgetCount(stream, undefined)).toBe(1);
    });
});

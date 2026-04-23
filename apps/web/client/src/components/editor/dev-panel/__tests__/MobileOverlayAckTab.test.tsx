import { describe, expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';

import type {
    ConsoleMessage,
    OverlayAckMessage,
    WsMessage,
} from '@onlook/mobile-client-protocol';

import {
    MobileOverlayAckRow,
    MobileOverlayAckTab,
    filterOverlayAcks,
} from '../MobileOverlayAckTab';

function makeAck(
    overrides: Partial<OverlayAckMessage> = {},
): OverlayAckMessage {
    return {
        type: 'onlook:overlayAck',
        sessionId: 'sess-1',
        overlayHash: 'a'.repeat(64),
        status: 'mounted',
        timestamp: 1_712_000_000_000,
        ...overrides,
    };
}

function makeConsoleMsg(): ConsoleMessage {
    return {
        type: 'onlook:console',
        sessionId: 'sess-1',
        level: 'log',
        args: ['hello'],
        timestamp: 1_712_000_000_000,
    };
}

describe('filterOverlayAcks', () => {
    test('keeps only onlook:overlayAck entries', () => {
        const acks: WsMessage[] = [makeConsoleMsg()];
        const ack = makeAck();
        const result = filterOverlayAcks([...acks, ack]);
        expect(result).toEqual([ack]);
    });

    test('filters by sessionId when provided', () => {
        const a = makeAck({ sessionId: 'sess-a', overlayHash: 'h-a' });
        const b = makeAck({ sessionId: 'sess-b', overlayHash: 'h-b' });
        expect(filterOverlayAcks([a, b], 'sess-a')).toEqual([a]);
    });

    test('preserves insertion order across mixed streams', () => {
        const a = makeAck({ overlayHash: 'h-1', timestamp: 1 });
        const b = makeAck({ overlayHash: 'h-2', timestamp: 2 });
        const c = makeAck({ overlayHash: 'h-3', timestamp: 3 });
        const result = filterOverlayAcks([a, makeConsoleMsg(), b, makeConsoleMsg(), c]);
        expect(result.map((x) => x.overlayHash)).toEqual(['h-1', 'h-2', 'h-3']);
    });

    test('returns empty array when no acks present', () => {
        expect(filterOverlayAcks([makeConsoleMsg()])).toEqual([]);
    });
});

describe('MobileOverlayAckRow', () => {
    test('renders a mounted ack with emerald badge + short hash', () => {
        const markup = renderToStaticMarkup(
            <MobileOverlayAckRow
                ack={makeAck({
                    overlayHash: 'abcdef1234567890deadbeefcafebabe',
                    timestamp: 1_712_000_000_000,
                })}
            />,
        );
        expect(markup).toContain('data-testid="mobile-overlay-ack-row"');
        expect(markup).toContain('data-status="mounted"');
        expect(markup).toContain('MOUNTED');
        expect(markup).toContain('emerald-500/20');
        expect(markup).toContain('abcdef12…babe');
        expect(markup).not.toContain('mobile-overlay-ack-error');
    });

    test('renders a failed ack with red badge + error line', () => {
        const markup = renderToStaticMarkup(
            <MobileOverlayAckRow
                ack={makeAck({
                    status: 'failed',
                    error: {
                        kind: 'overlay-runtime',
                        message: 'TypeError: x is not a function',
                    },
                })}
            />,
        );
        expect(markup).toContain('FAILED');
        expect(markup).toContain('red-500/25');
        expect(markup).toContain('mobile-overlay-ack-error');
        expect(markup).toContain('overlay-runtime');
        expect(markup).toContain('TypeError: x is not a function');
    });

    test('timestamp rendered as HH:MM:SS.mmm UTC', () => {
        // 2024-04-01T12:34:56.789Z
        const markup = renderToStaticMarkup(
            <MobileOverlayAckRow
                ack={makeAck({ timestamp: Date.UTC(2024, 3, 1, 12, 34, 56, 789) })}
            />,
        );
        expect(markup).toContain('12:34:56.789');
    });

    test('short hash is full value when ≤14 chars', () => {
        const markup = renderToStaticMarkup(
            <MobileOverlayAckRow ack={makeAck({ overlayHash: 'short-hash' })} />,
        );
        expect(markup).toContain('short-hash');
        expect(markup).not.toContain('…');
    });

    test('sessionId shown on the right', () => {
        const markup = renderToStaticMarkup(
            <MobileOverlayAckRow ack={makeAck({ sessionId: 'my-sess' })} />,
        );
        expect(markup).toContain('data-testid="mobile-overlay-ack-session"');
        expect(markup).toContain('my-sess');
    });
});

describe('MobileOverlayAckTab', () => {
    test('renders empty-state placeholder when no acks', () => {
        const markup = renderToStaticMarkup(<MobileOverlayAckTab acks={[]} />);
        expect(markup).toContain('data-testid="mobile-overlay-ack-empty"');
        expect(markup).toContain('No overlay mounts yet');
    });

    test('renders each ack as a row', () => {
        const acks = [
            makeAck({ overlayHash: 'h-1' }),
            makeAck({ overlayHash: 'h-2', status: 'failed' }),
        ];
        const markup = renderToStaticMarkup(<MobileOverlayAckTab acks={acks} />);
        expect(markup).toContain('data-testid="mobile-overlay-ack-tab"');
        // Count rows
        const rowCount = (markup.match(/mobile-overlay-ack-row/g) ?? []).length;
        expect(rowCount).toBe(2);
    });

    test('filters by sessionId when prop supplied', () => {
        const acks = [
            makeAck({ sessionId: 'sess-a', overlayHash: 'h-a' }),
            makeAck({ sessionId: 'sess-b', overlayHash: 'h-b' }),
            makeAck({ sessionId: 'sess-a', overlayHash: 'h-c' }),
        ];
        const markup = renderToStaticMarkup(
            <MobileOverlayAckTab acks={acks} sessionId="sess-a" />,
        );
        const rowCount = (markup.match(/mobile-overlay-ack-row/g) ?? []).length;
        expect(rowCount).toBe(2);
        expect(markup).not.toContain('h-b');
    });

    test('accepts a mixed WsMessage stream', () => {
        const mixed: Array<OverlayAckMessage | WsMessage> = [
            makeAck({ overlayHash: 'h-real' }),
            makeConsoleMsg(),
            makeAck({ overlayHash: 'h-real-2' }),
        ];
        const markup = renderToStaticMarkup(<MobileOverlayAckTab acks={mixed} />);
        const rowCount = (markup.match(/mobile-overlay-ack-row/g) ?? []).length;
        expect(rowCount).toBe(2);
    });

    test('outer class prop composes with defaults', () => {
        const markup = renderToStaticMarkup(
            <MobileOverlayAckTab acks={[makeAck()]} className="custom-class" />,
        );
        expect(markup).toContain('custom-class');
    });
});

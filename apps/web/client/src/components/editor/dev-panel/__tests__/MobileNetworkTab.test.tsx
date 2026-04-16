/**
 * Tests for MobileNetworkTab (MC5.17).
 *
 * Mirrors the testing strategy used by `MobileConsoleTab.test.tsx`
 * (MC5.16): the web-client workspace ships without jsdom, so we
 * render with `react-dom/server`'s `renderToStaticMarkup` and assert
 * on the emitted markup via `data-testid` hooks. The row-click
 * toggle is covered by exercising the pure `computeNextSelected`
 * reducer plus rendering the row component with both `selected`
 * values — together these give the same coverage as a DOM-click
 * test without needing jsdom.
 */

import { describe, expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';

import type {
    BundleUpdateMessage,
    NetworkMessage,
    SelectMessage,
    WsMessage,
} from '@onlook/mobile-client-protocol';

import {
    MobileNetworkRow,
    MobileNetworkTab,
    computeNextSelected,
    filterNetworkMessages,
    statusColorClass,
} from '../MobileNetworkTab';

function makeNetworkMsg(
    opts: Partial<NetworkMessage> & { requestId: string } = {
        requestId: 'req-1',
    },
): NetworkMessage {
    return {
        type: 'onlook:network',
        sessionId: opts.sessionId ?? 'sess-1',
        requestId: opts.requestId,
        method: opts.method ?? 'GET',
        url: opts.url ?? 'https://example.com/api',
        status: opts.status,
        durationMs: opts.durationMs,
        phase: opts.phase ?? 'end',
        timestamp: opts.timestamp ?? 1_712_000_000_000,
    };
}

describe('filterNetworkMessages', () => {
    test('keeps only onlook:network entries and drops unrelated messages', () => {
        const select: SelectMessage = {
            type: 'onlook:select',
            sessionId: 'sess-1',
            reactTag: 42,
            source: { fileName: 'App.tsx', lineNumber: 12, columnNumber: 4 },
        };
        const bundle: BundleUpdateMessage = {
            type: 'bundleUpdate',
            sessionId: 'sess-1',
            bundleUrl: 'https://example.com/b.js',
            onlookRuntimeVersion: '1.0.0',
            timestamp: 1,
        };
        const net = makeNetworkMsg({ requestId: 'req-1', status: 200 });
        const msgs: WsMessage[] = [select, bundle, net];
        const out = filterNetworkMessages(msgs);
        expect(out).toHaveLength(1);
        expect(out[0]).toBe(net);
    });

    test('collapses start/end phases for the same requestId to the latest phase', () => {
        const start = makeNetworkMsg({
            requestId: 'req-1',
            phase: 'start',
            status: undefined,
            durationMs: undefined,
        });
        const end = makeNetworkMsg({
            requestId: 'req-1',
            phase: 'end',
            status: 200,
            durationMs: 42,
        });
        const out = filterNetworkMessages([start, end]);
        expect(out).toHaveLength(1);
        expect(out[0]).toBe(end);
    });

    test('filters by sessionId when provided', () => {
        const a = makeNetworkMsg({ requestId: 'req-a', sessionId: 'sess-1' });
        const b = makeNetworkMsg({ requestId: 'req-b', sessionId: 'sess-2' });
        const out = filterNetworkMessages([a, b], 'sess-2');
        expect(out).toHaveLength(1);
        expect(out[0]).toBe(b);
    });
});

describe('statusColorClass', () => {
    test('returns neutral for pending (undefined) status', () => {
        expect(statusColorClass(undefined)).toContain('neutral');
    });
    test('returns green for 2xx', () => {
        expect(statusColorClass(200)).toContain('green-500');
        expect(statusColorClass(204)).toContain('green-500');
    });
    test('returns amber for 4xx', () => {
        expect(statusColorClass(404)).toContain('amber-500');
        expect(statusColorClass(401)).toContain('amber-500');
    });
    test('returns red for 5xx', () => {
        expect(statusColorClass(500)).toContain('red-500');
        expect(statusColorClass(503)).toContain('red-500');
    });
});

describe('computeNextSelected', () => {
    test('selects an unselected row on click', () => {
        expect(computeNextSelected(null, 'req-1')).toBe('req-1');
    });
    test('switches selection to a different row', () => {
        expect(computeNextSelected('req-1', 'req-2')).toBe('req-2');
    });
    test('deselects when the currently-selected row is clicked again', () => {
        expect(computeNextSelected('req-1', 'req-1')).toBeNull();
    });
});

describe('MobileNetworkTab empty state', () => {
    test('renders the "No network activity" placeholder when the stream is empty', () => {
        const html = renderToStaticMarkup(<MobileNetworkTab messages={[]} />);
        expect(html).toContain('data-testid="mobile-network-empty"');
        expect(html).toContain('No network activity');
    });

    test('renders the placeholder when the stream has no network entries', () => {
        const select: SelectMessage = {
            type: 'onlook:select',
            sessionId: 'sess-1',
            reactTag: 1,
            source: { fileName: 'App.tsx', lineNumber: 1, columnNumber: 0 },
        };
        const html = renderToStaticMarkup(
            <MobileNetworkTab messages={[select]} />,
        );
        expect(html).toContain('data-testid="mobile-network-empty"');
    });
});

describe('MobileNetworkTab populated', () => {
    test('renders one row per request with method, URL, status, and duration', () => {
        const msgs: NetworkMessage[] = [
            makeNetworkMsg({
                requestId: 'req-1',
                method: 'GET',
                url: 'https://example.com/users',
                status: 200,
                durationMs: 42,
            }),
            makeNetworkMsg({
                requestId: 'req-2',
                method: 'POST',
                url: 'https://example.com/auth',
                status: 401,
                durationMs: 120,
            }),
            makeNetworkMsg({
                requestId: 'req-3',
                method: 'GET',
                url: 'https://example.com/search',
                status: 503,
                durationMs: 800,
            }),
        ];
        const html = renderToStaticMarkup(
            <MobileNetworkTab messages={msgs} />,
        );
        expect(html).toContain('data-testid="mobile-network-scroll"');
        const rowMatches = html.match(/data-testid="mobile-network-row"/g);
        expect(rowMatches?.length ?? 0).toBe(3);
        expect(html).toContain('https://example.com/users');
        expect(html).toContain('https://example.com/auth');
        expect(html).toContain('https://example.com/search');
        expect(html).toContain('>GET<');
        expect(html).toContain('>POST<');
        expect(html).toContain('>200<');
        expect(html).toContain('>401<');
        expect(html).toContain('>503<');
        expect(html).toContain('42 ms');
        expect(html).toContain('120 ms');
    });

    test('colour-codes status by class (2xx/4xx/5xx/pending)', () => {
        const msgs: NetworkMessage[] = [
            makeNetworkMsg({ requestId: 'req-ok', status: 200, durationMs: 5 }),
            makeNetworkMsg({ requestId: 'req-bad', status: 404, durationMs: 5 }),
            makeNetworkMsg({ requestId: 'req-err', status: 500, durationMs: 5 }),
            makeNetworkMsg({
                requestId: 'req-pending',
                phase: 'start',
                status: undefined,
                durationMs: undefined,
            }),
        ];
        const html = renderToStaticMarkup(
            <MobileNetworkTab messages={msgs} />,
        );
        // One status span per row — check the colour class lands on the
        // right row by scoping on the data-status attribute.
        expect(html).toMatch(
            /data-status="200"[^>]*text-green-500/,
        );
        expect(html).toMatch(
            /data-status="404"[^>]*text-amber-500/,
        );
        expect(html).toMatch(
            /data-status="500"[^>]*text-red-500/,
        );
        // Pending row renders the "pending" label in neutral.
        expect(html).toContain('>pending<');
        expect(html).toMatch(/data-status=""[^>]*text-neutral-500/);
    });

    test('row toggles the details panel based on the `selected` prop', () => {
        const msg = makeNetworkMsg({
            requestId: 'req-detail',
            method: 'PATCH',
            url: 'https://example.com/v2/thing',
            status: 204,
            durationMs: 77,
            timestamp: Date.UTC(2026, 3, 11, 13, 45, 12, 500),
        });

        const collapsed = renderToStaticMarkup(
            <MobileNetworkRow
                message={msg}
                selected={false}
                onToggle={() => {}}
            />,
        );
        expect(collapsed).not.toContain('data-testid="mobile-network-details"');
        expect(collapsed).toContain('data-selected="false"');

        const expanded = renderToStaticMarkup(
            <MobileNetworkRow
                message={msg}
                selected={true}
                onToggle={() => {}}
            />,
        );
        expect(expanded).toContain('data-testid="mobile-network-details"');
        expect(expanded).toContain('data-selected="true"');
        // Details panel surfaces fields not shown in the table row.
        expect(expanded).toContain('req-detail');
        expect(expanded).toContain('Request ID');
        expect(expanded).toContain('Timestamp');
        expect(expanded).toContain('13:45:12.500');
    });

    test('filters by sessionId when the prop is set', () => {
        const a = makeNetworkMsg({
            requestId: 'req-a',
            sessionId: 'sess-1',
            url: 'https://example.com/from-1',
        });
        const b = makeNetworkMsg({
            requestId: 'req-b',
            sessionId: 'sess-2',
            url: 'https://example.com/from-2',
        });
        const html = renderToStaticMarkup(
            <MobileNetworkTab messages={[a, b]} sessionId="sess-2" />,
        );
        expect(html).toContain('https://example.com/from-2');
        expect(html).not.toContain('https://example.com/from-1');
    });
});

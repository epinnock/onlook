/**
 * Tests for MobileConsoleTab (MC5.16).
 *
 * jsdom is not available in this workspace, so — following the
 * precedent set by `qr-modal.test.tsx` (TQ3.1) — we render via
 * `react-dom/server`'s `renderToStaticMarkup` and assert on the markup
 * via `data-testid` hooks. The auto-scroll effect is deliberately not
 * covered here (server-render does not fire effects); it's exercised
 * manually against the running editor + verified via Maestro in a later
 * Wave 5 flow.
 */

import { describe, expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';

import type {
    BundleUpdateMessage,
    ConsoleLevel,
    ConsoleMessage,
    SelectMessage,
    WsMessage,
} from '@onlook/mobile-client-protocol';

import {
    MobileConsoleRow,
    MobileConsoleTab,
    filterConsoleMessages,
} from '../MobileConsoleTab';

function makeConsoleMsg(
    level: ConsoleLevel,
    args: string[],
    opts: { sessionId?: string; timestamp?: number } = {},
): ConsoleMessage {
    return {
        type: 'onlook:console',
        sessionId: opts.sessionId ?? 'sess-1',
        level,
        args,
        timestamp: opts.timestamp ?? 1_712_000_000_000,
    };
}

describe('filterConsoleMessages', () => {
    test('keeps only onlook:console entries', () => {
        const select: SelectMessage = {
            type: 'onlook:select',
            sessionId: 'sess-1',
            reactTag: 42,
            source: {
                fileName: 'App.tsx',
                lineNumber: 12,
                columnNumber: 4,
            },
        };
        const bundle: BundleUpdateMessage = {
            type: 'bundleUpdate',
            sessionId: 'sess-1',
            bundleUrl: 'https://example.com/b.js',
            onlookRuntimeVersion: '1.0.0',
            timestamp: 1,
        };
        const log = makeConsoleMsg('log', ['hello']);
        const msgs: WsMessage[] = [select, bundle, log];
        const out = filterConsoleMessages(msgs);
        expect(out).toHaveLength(1);
        expect(out[0]).toBe(log);
    });

    test('filters by sessionId when provided', () => {
        const a = makeConsoleMsg('log', ['a'], { sessionId: 'sess-1' });
        const b = makeConsoleMsg('log', ['b'], { sessionId: 'sess-2' });
        const out = filterConsoleMessages([a, b], 'sess-2');
        expect(out).toHaveLength(1);
        expect(out[0]).toBe(b);
    });

    test('returns every session when sessionId is omitted', () => {
        const a = makeConsoleMsg('log', ['a'], { sessionId: 'sess-1' });
        const b = makeConsoleMsg('log', ['b'], { sessionId: 'sess-2' });
        const out = filterConsoleMessages([a, b]);
        expect(out).toHaveLength(2);
    });
});

describe('MobileConsoleTab empty state', () => {
    test('renders the "No console output" placeholder when the stream is empty', () => {
        const html = renderToStaticMarkup(<MobileConsoleTab messages={[]} />);
        expect(html).toContain('data-testid="mobile-console-empty"');
        expect(html).toContain('No console output');
    });

    test('renders the placeholder when the stream has no console entries', () => {
        const select: SelectMessage = {
            type: 'onlook:select',
            sessionId: 'sess-1',
            reactTag: 1,
            source: {
                fileName: 'App.tsx',
                lineNumber: 1,
                columnNumber: 0,
            },
        };
        const html = renderToStaticMarkup(
            <MobileConsoleTab messages={[select]} />,
        );
        expect(html).toContain('data-testid="mobile-console-empty"');
    });
});

describe('MobileConsoleTab populated', () => {
    test('renders one row per console entry with level + message + timestamp', () => {
        const msgs: ConsoleMessage[] = [
            makeConsoleMsg('log', ['hello world'], {
                timestamp: Date.UTC(2026, 3, 11, 13, 45, 12, 500),
            }),
            makeConsoleMsg('warn', ['heads up']),
            makeConsoleMsg('error', ['boom']),
        ];
        const html = renderToStaticMarkup(
            <MobileConsoleTab messages={msgs} />,
        );
        expect(html).toContain('data-testid="mobile-console-scroll"');
        // 3 rows rendered.
        const rowMatches = html.match(/data-testid="mobile-console-row"/g);
        expect(rowMatches?.length ?? 0).toBe(3);
        // Timestamp formatting is stable + in UTC.
        expect(html).toContain('13:45:12.500');
        // Messages are rendered verbatim (args joined with spaces).
        expect(html).toContain('hello world');
        expect(html).toContain('heads up');
        expect(html).toContain('boom');
        // Level badges carry the level via data-attr for colour-blind-safe selection.
        expect(html).toContain('data-level="log"');
        expect(html).toContain('data-level="warn"');
        expect(html).toContain('data-level="error"');
    });

    test('joins pre-stringified args with a single space', () => {
        const msg = makeConsoleMsg('info', ['user', '{"id":1}', 'logged in']);
        const html = renderToStaticMarkup(<MobileConsoleRow message={msg} />);
        expect(html).toContain('user {&quot;id&quot;:1} logged in');
    });

    test('per-level badge labels match the protocol', () => {
        const levels: ConsoleLevel[] = ['log', 'info', 'warn', 'error', 'debug'];
        const msgs = levels.map((l) => makeConsoleMsg(l, [`${l} msg`]));
        const html = renderToStaticMarkup(
            <MobileConsoleTab messages={msgs} />,
        );
        expect(html).toContain('>LOG<');
        expect(html).toContain('>INFO<');
        expect(html).toContain('>WARN<');
        expect(html).toContain('>ERR<');
        expect(html).toContain('>DBG<');
    });

    test('filters by sessionId when the prop is set', () => {
        const a = makeConsoleMsg('log', ['from 1'], { sessionId: 'sess-1' });
        const b = makeConsoleMsg('log', ['from 2'], { sessionId: 'sess-2' });
        const html = renderToStaticMarkup(
            <MobileConsoleTab messages={[a, b]} sessionId="sess-2" />,
        );
        expect(html).toContain('from 2');
        expect(html).not.toContain('from 1');
    });
});

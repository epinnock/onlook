/**
 * Tests for `wireOnlookSelectToIdeManager` — the production
 * tap-to-source wiring that bridges the MC4.15 receiver to the
 * editor's CodeMirror-driven IdeManager (replaces the Monaco-shaped
 * wireCursorJump that never matched this codebase).
 *
 * Strategy: dispatch wire-format `onlook:select` payloads through the
 * receiver and assert IdeManager-spy methods receive the correct args.
 * No editor engine, no MobX, no CodeMirror — pure glue verification.
 */

import { afterEach, describe, expect, test } from 'bun:test';

import {
    __resetOnlookSelectReceiverForTests,
    dispatchOnlookSelect,
} from '../onlookSelectReceiver';
import {
    wireOnlookSelectToIdeManager,
    type OpenCodeLocationCapableIde,
} from '../wireOnlookSelectToIdeManager';

afterEach(() => {
    __resetOnlookSelectReceiverForTests();
});

interface SpyCall {
    fileName: string;
    lineNumber: number;
    columnNumber: number;
}

function makeIdeSpy(): {
    ide: OpenCodeLocationCapableIde;
    calls: SpyCall[];
} {
    const calls: SpyCall[] = [];
    return {
        calls,
        ide: {
            openCodeLocation(fileName, lineNumber, columnNumber) {
                calls.push({ fileName, lineNumber, columnNumber });
            },
        },
    };
}

describe('wireOnlookSelectToIdeManager', () => {
    test('forwards a wire-format select message to openCodeLocation', () => {
        const { ide, calls } = makeIdeSpy();
        const unsubscribe = wireOnlookSelectToIdeManager(ide);

        dispatchOnlookSelect({
            type: 'onlook:select',
            sessionId: 'sess-1',
            reactTag: 99,
            source: {
                fileName: 'apps/web/client/src/app/page.tsx',
                lineNumber: 24,
                columnNumber: 8,
            },
            timestamp: 1_712_000_000_000,
        });

        expect(calls).toHaveLength(1);
        expect(calls[0]).toEqual({
            fileName: 'apps/web/client/src/app/page.tsx',
            lineNumber: 24,
            columnNumber: 8,
        });
        unsubscribe();
    });

    test('forwards a flat-format select message identically', () => {
        const { ide, calls } = makeIdeSpy();
        wireOnlookSelectToIdeManager(ide);

        dispatchOnlookSelect({
            type: 'onlook:select',
            fileName: 'src/App.tsx',
            lineNumber: 1,
            columnNumber: 0,
            timestamp: '2026-04-25T05:00:00.000Z',
        });

        expect(calls).toHaveLength(1);
        expect(calls[0]).toEqual({
            fileName: 'src/App.tsx',
            lineNumber: 1,
            columnNumber: 0,
        });
    });

    test('unsubscribe stops further forwarding', () => {
        const { ide, calls } = makeIdeSpy();
        const unsubscribe = wireOnlookSelectToIdeManager(ide);

        dispatchOnlookSelect({
            type: 'onlook:select',
            sessionId: 's',
            reactTag: 1,
            source: { fileName: 'a.tsx', lineNumber: 1, columnNumber: 0 },
        });
        expect(calls).toHaveLength(1);

        unsubscribe();
        dispatchOnlookSelect({
            type: 'onlook:select',
            sessionId: 's',
            reactTag: 2,
            source: { fileName: 'b.tsx', lineNumber: 2, columnNumber: 0 },
        });
        expect(calls).toHaveLength(1);
    });

    test('multiple subscriptions all fire on a dispatch', () => {
        const { ide: ideA, calls: callsA } = makeIdeSpy();
        const { ide: ideB, calls: callsB } = makeIdeSpy();
        wireOnlookSelectToIdeManager(ideA);
        wireOnlookSelectToIdeManager(ideB);

        dispatchOnlookSelect({
            type: 'onlook:select',
            sessionId: 's',
            reactTag: 1,
            source: { fileName: 'multi.tsx', lineNumber: 5, columnNumber: 3 },
        });

        expect(callsA).toHaveLength(1);
        expect(callsB).toHaveLength(1);
        expect(callsA[0]).toEqual(callsB[0]);
    });

    test('onMessage diagnostic hook fires before openCodeLocation', () => {
        const order: string[] = [];
        const ide: OpenCodeLocationCapableIde = {
            openCodeLocation() {
                order.push('open');
            },
        };
        wireOnlookSelectToIdeManager(ide, {
            onMessage: () => order.push('hook'),
        });

        dispatchOnlookSelect({
            type: 'onlook:select',
            sessionId: 's',
            reactTag: 1,
            source: { fileName: 'a.tsx', lineNumber: 1, columnNumber: 0 },
        });

        expect(order).toEqual(['hook', 'open']);
    });

    test('malformed messages are dropped by the receiver before reaching openCodeLocation', () => {
        const { ide, calls } = makeIdeSpy();
        wireOnlookSelectToIdeManager(ide);

        // Receiver drops anything that doesn't match the schema — this
        // helper inherits that guard.
        dispatchOnlookSelect({ type: 'unknown', fileName: 'x.tsx' });
        dispatchOnlookSelect(null as unknown as never);
        dispatchOnlookSelect({
            type: 'onlook:select',
            // missing source
        });

        expect(calls).toEqual([]);
    });
});

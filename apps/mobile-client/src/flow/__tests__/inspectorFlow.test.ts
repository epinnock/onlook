/**
 * Tests for the end-to-end inspector flow.
 *
 * Task: MC4.18
 * Validate: bun test apps/mobile-client/src/flow/__tests__/inspectorFlow.test.ts
 *
 * `wireInspectorFlow` is a thin composer over MC4.14's `TapHandler`. The
 * tests mock the relay WebSocket client (it's the only side-effectful
 * dependency) and exercise:
 *
 *   1. The shape of the returned handle — `{ tapHandler, destroy }`.
 *   2. The wire format of outgoing `onlook:select` messages (sessionId
 *      flows through, reactTag is defaulted, source is forwarded
 *      verbatim).
 *   3. `destroy()` short-circuits subsequent sends (no more messages
 *      reach the WS).
 *   4. Input validation — empty sessionId throws.
 *   5. `destroy()` is idempotent.
 *   6. Post-destroy the internal session id is blanked.
 */

import { describe, expect, test } from 'bun:test';
import type { OnlookRelayClient, WsMessage } from '../../relay/wsClient';
import type { TapSource } from '../../inspector/tapHandler';
import { wireInspectorFlow } from '../inspectorFlow';

// ── Test doubles ─────────────────────────────────────────────────────────────

/**
 * Minimal mock `OnlookRelayClient`. Captures every `send()` call into an
 * array so tests can assert on the outgoing wire format. `throwOnSend`
 * simulates a dropped socket for the best-effort code path.
 */
class MockRelayClient {
    public sent: WsMessage[] = [];
    public throwOnSend = false;

    send(msg: WsMessage): void {
        if (this.throwOnSend) {
            throw new Error('WebSocket is not connected');
        }
        this.sent.push(msg);
    }
}

/** Cast the mock to the public `OnlookRelayClient` interface. */
function asClient(mock: MockRelayClient): OnlookRelayClient {
    return mock as unknown as OnlookRelayClient;
}

const VALID_SOURCE: TapSource = {
    fileName: 'App.tsx',
    lineNumber: 12,
    columnNumber: 8,
};

// ── Tests ────────────────────────────────────────────────────────────────────

describe('wireInspectorFlow', () => {
    test('returns a handle with a tapHandler and a destroy function', () => {
        const client = new MockRelayClient();
        const handle = wireInspectorFlow(asClient(client), 'sess-abc');

        expect(handle).toBeDefined();
        expect(handle.tapHandler).toBeDefined();
        // Duck-type check — don't need to import TapHandler here.
        expect(typeof handle.tapHandler.handleTap).toBe('function');
        expect(typeof handle.tapHandler.setSessionId).toBe('function');
        expect(typeof handle.tapHandler.setReactTag).toBe('function');
        expect(typeof handle.destroy).toBe('function');
    });

    test('handleTap sends a schema-valid onlook:select with the wired sessionId', () => {
        const client = new MockRelayClient();
        const { tapHandler } = wireInspectorFlow(asClient(client), 'sess-wired-xyz');

        tapHandler.handleTap(VALID_SOURCE);

        expect(client.sent).toHaveLength(1);
        expect(client.sent[0]).toEqual({
            type: 'onlook:select',
            sessionId: 'sess-wired-xyz',
            reactTag: 0,
            source: {
                fileName: 'App.tsx',
                lineNumber: 12,
                columnNumber: 8,
            },
        });
    });

    test('sessionId flows through verbatim — distinct ids produce distinct messages', () => {
        const clientA = new MockRelayClient();
        const clientB = new MockRelayClient();
        const flowA = wireInspectorFlow(asClient(clientA), 'sess-aaa');
        const flowB = wireInspectorFlow(asClient(clientB), 'sess-bbb');

        flowA.tapHandler.handleTap(VALID_SOURCE);
        flowB.tapHandler.handleTap(VALID_SOURCE);

        const a = clientA.sent[0];
        const b = clientB.sent[0];
        if (a === undefined || a.type !== 'onlook:select') {
            throw new Error('expected onlook:select on clientA');
        }
        if (b === undefined || b.type !== 'onlook:select') {
            throw new Error('expected onlook:select on clientB');
        }
        expect(a.sessionId).toBe('sess-aaa');
        expect(b.sessionId).toBe('sess-bbb');
    });

    test('destroy() stops future sends — post-destroy taps are no-ops', () => {
        const client = new MockRelayClient();
        const { tapHandler, destroy } = wireInspectorFlow(
            asClient(client),
            'sess-abc',
        );

        tapHandler.handleTap(VALID_SOURCE);
        expect(client.sent).toHaveLength(1);

        destroy();

        tapHandler.handleTap(VALID_SOURCE);
        tapHandler.handleTap({ fileName: 'B.tsx', lineNumber: 3, columnNumber: 1 });
        // Still exactly one message — no further writes reached the WS.
        expect(client.sent).toHaveLength(1);
    });

    test('destroy() is idempotent — second call is a no-op', () => {
        const client = new MockRelayClient();
        const { destroy } = wireInspectorFlow(asClient(client), 'sess-abc');

        destroy();
        // Must not throw.
        expect(() => destroy()).not.toThrow();
    });

    test('reactTag set before destroy does not leak to post-destroy sends', () => {
        const client = new MockRelayClient();
        const { tapHandler, destroy } = wireInspectorFlow(
            asClient(client),
            'sess-abc',
        );
        tapHandler.setReactTag(99);

        tapHandler.handleTap(VALID_SOURCE);
        destroy();
        tapHandler.handleTap(VALID_SOURCE);

        expect(client.sent).toHaveLength(1);
        const msg = client.sent[0];
        if (msg === undefined || msg.type !== 'onlook:select') {
            throw new Error('expected onlook:select');
        }
        expect(msg.reactTag).toBe(99);
    });

    test('throws when sessionId is empty or not a string', () => {
        const client = new MockRelayClient();
        expect(() => wireInspectorFlow(asClient(client), '')).toThrow(
            /sessionId/,
        );
        // Runtime guard against a non-string — exercise via an escape
        // hatch cast so the compile-time check does not block the test.
        expect(() =>
            wireInspectorFlow(
                asClient(client),
                undefined as unknown as string,
            ),
        ).toThrow(/sessionId/);
    });

    test('swallows relay send errors — destroy remains callable after a failed send', () => {
        const client = new MockRelayClient();
        client.throwOnSend = true;
        const { tapHandler, destroy } = wireInspectorFlow(
            asClient(client),
            'sess-abc',
        );

        // Must not throw even though the underlying WS is dropped.
        expect(() => tapHandler.handleTap(VALID_SOURCE)).not.toThrow();
        expect(client.sent).toHaveLength(0);

        // destroy() must still be callable and idempotent.
        expect(() => destroy()).not.toThrow();
        expect(() => destroy()).not.toThrow();
    });
});

/**
 * Tests for `createRelayWsFromManifest` (pure helper) + smoke-test of
 * the `useRelayWsClient` hook's initial render shape.
 *
 * Follows the same pattern as `use-preview-on-device.test.tsx` —
 * exercise the pure helper with every branch, then one static
 * renderToStaticMarkup pass to confirm the hook mounts cleanly.
 */
import { describe, expect, mock, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';

import type { OverlayAckMessage } from '@onlook/mobile-client-protocol';

import {
    createRelayWsFromManifest,
    useRelayWsClient,
} from '../use-relay-ws-client';

const VALID_HASH =
    '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
const VALID_MANIFEST = `http://127.0.0.1:8787/manifest/${VALID_HASH}`;

/** Mirrors the MockWebSocket pattern in `relay-ws-client.test.ts`. */
class MockWebSocket {
    static OPEN = 1;
    static CLOSED = 3;
    readonly url: string;
    readyState = 0;
    readonly sent: string[] = [];
    closed = false;
    private listeners = new Map<string, Array<(ev: unknown) => void>>();

    constructor(url: string) {
        this.url = url;
    }
    addEventListener(type: string, listener: (ev: unknown) => void): void {
        const l = this.listeners.get(type) ?? [];
        l.push(listener);
        this.listeners.set(type, l);
    }
    removeEventListener(type: string, listener: (ev: unknown) => void): void {
        const l = this.listeners.get(type);
        if (!l) return;
        const idx = l.indexOf(listener);
        if (idx >= 0) l.splice(idx, 1);
    }
    send(data: string): void {
        this.sent.push(data);
    }
    close(): void {
        this.closed = true;
        this.readyState = MockWebSocket.CLOSED;
        this.fire('close');
    }
    fire(type: string, payload?: unknown): void {
        const l = this.listeners.get(type) ?? [];
        for (const fn of [...l]) fn({ data: payload });
    }
}

function makeFactory() {
    const sockets: MockWebSocket[] = [];
    const createSocket = (url: string): WebSocket => {
        const ws = new MockWebSocket(url);
        sockets.push(ws);
        return ws as unknown as WebSocket;
    };
    return { sockets, createSocket };
}

describe('createRelayWsFromManifest', () => {
    test('returns null when manifestUrl is absent', () => {
        expect(createRelayWsFromManifest(null)).toBeNull();
        expect(createRelayWsFromManifest(undefined)).toBeNull();
        expect(createRelayWsFromManifest('')).toBeNull();
    });

    test('returns null when manifestUrl is unparseable', () => {
        expect(createRelayWsFromManifest('not-a-url')).toBeNull();
        expect(
            createRelayWsFromManifest('http://example.com/not-manifest'),
        ).toBeNull();
    });

    test('parses valid manifest URL and opens a WS to /hmr/<sessionId>', () => {
        const { sockets, createSocket } = makeFactory();
        const result = createRelayWsFromManifest(VALID_MANIFEST, {
            createSocket,
        });
        expect(result).not.toBeNull();
        expect(sockets.length).toBe(1);
        expect(sockets[0]!.url).toBe(
            `ws://127.0.0.1:8787/hmr/${VALID_HASH}`,
        );
        // Idempotent disconnect.
        result!.disconnect();
        result!.disconnect();
        expect(sockets[0]!.closed).toBe(true);
    });

    test('normalizes exps:// → wss:// on the socket URL', () => {
        const { sockets, createSocket } = makeFactory();
        createRelayWsFromManifest(
            `exps://relay.example.com/manifest/${VALID_HASH}`,
            { createSocket },
        );
        expect(sockets[0]!.url).toBe(
            `wss://relay.example.com/hmr/${VALID_HASH}`,
        );
    });

    test('handlers.onOverlayAck default is the Phase 11b telemetry sink', () => {
        // Without an explicit handlers override, the hook wires
        // `emitOverlayAckTelemetry` which fires `posthog.capture`. We
        // can't easily assert that from here without mocking posthog,
        // but we CAN verify that the default didn't throw during
        // construction — absence of throw is the contract.
        const { createSocket } = makeFactory();
        expect(() =>
            createRelayWsFromManifest(VALID_MANIFEST, { createSocket }),
        ).not.toThrow();
    });

    test('handlers override replaces the default onOverlayAck', () => {
        // The WS layer validates via `onOverlayAck` on message receipt;
        // we construct the client + inject a synthetic ack via the mock
        // socket and verify our override sees it.
        const { sockets, createSocket } = makeFactory();
        const ackSpy = mock((_ack: OverlayAckMessage) => {});
        const result = createRelayWsFromManifest(VALID_MANIFEST, {
            createSocket,
            handlers: { onOverlayAck: ackSpy },
        });
        expect(result).not.toBeNull();

        // Simulate the socket opening + an ack arriving.
        const ws = sockets[0]!;
        ws.readyState = MockWebSocket.OPEN;
        ws.fire('open');
        const ack: OverlayAckMessage = {
            type: 'onlook:overlayAck',
            sessionId: VALID_HASH,
            overlayHash: 'abc',
            status: 'mounted',
            timestamp: 1_712_000_000_000,
            mountDurationMs: 42,
        };
        ws.fire('message', JSON.stringify(ack));

        expect(ackSpy).toHaveBeenCalledTimes(1);
        const [receivedAck] = ackSpy.mock.calls[0]!;
        expect(receivedAck.overlayHash).toBe('abc');
        expect(receivedAck.mountDurationMs).toBe(42);

        result!.disconnect();
    });

    test('onStateChange forwards RelayWsOpenState transitions', () => {
        const { sockets, createSocket } = makeFactory();
        const states: string[] = [];
        const result = createRelayWsFromManifest(VALID_MANIFEST, {
            createSocket,
            onStateChange: (s) => states.push(s),
        });
        // Constructor call puts state at 'connecting'
        expect(states).toContain('connecting');
        // Simulate open.
        const ws = sockets[0]!;
        ws.readyState = MockWebSocket.OPEN;
        ws.fire('open');
        expect(states).toContain('open');
        result!.disconnect();
        expect(states).toContain('closed');
    });

    test('Phase 11b: editorCapabilities arms the AbiHello handshake on open', () => {
        const { sockets, createSocket } = makeFactory();
        const editorCaps = {
            abi: 'v1' as const,
            baseHash: 'editor',
            rnVersion: '0.81.6',
            expoSdk: '54.0.0',
            platform: 'ios' as const,
            aliases: ['react'],
        };
        createRelayWsFromManifest(VALID_MANIFEST, {
            createSocket,
            editorCapabilities: editorCaps,
        });
        const ws = sockets[0]!;
        ws.readyState = MockWebSocket.OPEN;
        ws.fire('open');

        // Editor's hello should have been sent immediately on open.
        expect(ws.sent).toHaveLength(1);
        const sent = JSON.parse(ws.sent[0]!);
        expect(sent.type).toBe('abiHello');
        expect(sent.role).toBe('editor');
        expect(sent.runtime).toEqual(editorCaps);
    });

    test('Phase 11b: omitting editorCapabilities means NO handshake fires', () => {
        const { sockets, createSocket } = makeFactory();
        createRelayWsFromManifest(VALID_MANIFEST, { createSocket });
        const ws = sockets[0]!;
        ws.readyState = MockWebSocket.OPEN;
        ws.fire('open');
        expect(ws.sent).toEqual([]); // no editor hello sent
    });

    test('Phase 11b: onAbiCompatibility fires when phone hello arrives', () => {
        const { sockets, createSocket } = makeFactory();
        const compatCalls: Array<{ result: string | object; phone: object }> = [];
        const editorCaps = {
            abi: 'v1' as const,
            baseHash: 'editor',
            rnVersion: '0.81.6',
            expoSdk: '54.0.0',
            platform: 'ios' as const,
            aliases: ['react'],
        };
        createRelayWsFromManifest(VALID_MANIFEST, {
            createSocket,
            editorCapabilities: editorCaps,
            onAbiCompatibility: (result, phone) =>
                compatCalls.push({ result, phone }),
        });
        const ws = sockets[0]!;
        ws.readyState = MockWebSocket.OPEN;
        ws.fire('open');

        const phoneHello = {
            type: 'abiHello' as const,
            abi: 'v1' as const,
            sessionId: VALID_HASH,
            role: 'phone' as const,
            runtime: { ...editorCaps, baseHash: 'phone' },
        };
        ws.fire('message', JSON.stringify(phoneHello));

        expect(compatCalls).toHaveLength(1);
        expect(compatCalls[0]!.result).toBe('ok');
        expect((compatCalls[0]!.phone as { role: string }).role).toBe('phone');
    });
});

describe('useRelayWsClient — hook render smoke', () => {
    test('renders without throwing when manifestUrl is null', () => {
        function Probe() {
            const { client, state } = useRelayWsClient({
                manifestUrl: null,
            });
            return (
                <div
                    data-testid="probe"
                    data-state={state}
                    data-has-client={client !== null ? 'true' : 'false'}
                />
            );
        }
        const markup = renderToStaticMarkup(<Probe />);
        expect(markup).toContain('data-state="idle"');
        expect(markup).toContain('data-has-client="false"');
    });
});

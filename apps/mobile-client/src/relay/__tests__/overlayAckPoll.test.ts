import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';

import type { HttpGetResult, RelayEvent } from '@onlook/mobile-preview';

import {
    buildEventsUrl,
    resolveHttpGet,
    startOverlayAckPoll,
} from '../overlayAckPoll';

type RuntimeLike = {
    httpGet?: (url: string, headers?: Record<string, string>) => HttpGetResult;
};

type GlobalWithRuntime = typeof globalThis & { OnlookRuntime?: RuntimeLike };

let savedRuntime: RuntimeLike | undefined;

beforeEach(() => {
    savedRuntime = (globalThis as GlobalWithRuntime).OnlookRuntime;
});

afterEach(() => {
    (globalThis as GlobalWithRuntime).OnlookRuntime = savedRuntime;
});

describe('buildEventsUrl', () => {
    test('replaces manifest-style URL path with /events', () => {
        expect(buildEventsUrl('http://relay.example.com:8787/manifest/abc')).toBe(
            'http://relay.example.com:8787/events',
        );
    });

    test('replaces query params too', () => {
        expect(buildEventsUrl('https://relay.example.com/manifest/x?format=json')).toBe(
            'https://relay.example.com/events',
        );
    });

    test('appends /events to bare hostnames', () => {
        expect(buildEventsUrl('relay.example.com')).toBe('relay.example.com/events');
    });

    test('preserves an existing /events suffix', () => {
        expect(buildEventsUrl('http://relay.example.com/events')).toBe(
            'http://relay.example.com/events',
        );
    });

    test('trims trailing slashes before appending', () => {
        expect(buildEventsUrl('relay.example.com/')).toBe('relay.example.com/events');
    });
});

describe('resolveHttpGet', () => {
    test('returns undefined when OnlookRuntime.httpGet is missing', () => {
        (globalThis as GlobalWithRuntime).OnlookRuntime = {};
        expect(resolveHttpGet()).toBeUndefined();
    });

    test('returns undefined when OnlookRuntime itself is missing', () => {
        delete (globalThis as GlobalWithRuntime).OnlookRuntime;
        expect(resolveHttpGet()).toBeUndefined();
    });

    test('returns a callable bound to OnlookRuntime when installed', () => {
        const httpGet = mock((_url: string) => ({
            ok: true,
            status: 200,
            body: '{}',
            contentType: 'application/json',
        }));
        (globalThis as GlobalWithRuntime).OnlookRuntime = { httpGet };
        const resolved = resolveHttpGet();
        expect(typeof resolved).toBe('function');
        resolved?.('http://example.com');
        expect(httpGet).toHaveBeenCalledTimes(1);
    });
});

describe('startOverlayAckPoll', () => {
    test('returns installed:false no-op handle when httpGet is missing', () => {
        delete (globalThis as GlobalWithRuntime).OnlookRuntime;
        const handle = startOverlayAckPoll({
            relayHost: 'http://relay/events',
            sessionId: 's',
            onEvent: () => {},
        });
        expect(handle.installed).toBe(false);
        expect(handle.getCursor()).toBeUndefined();
        expect(() => handle.stop()).not.toThrow();
    });

    test('starts the poll when httpGet is installed; receives events', () => {
        const received: RelayEvent[] = [];
        // Payload is a valid `overlayAck` per the RelayEventSchema so the
        // default `validate: true` path accepts it.
        const body = JSON.stringify({
            events: [
                {
                    id: 'e1',
                    type: 'overlayAck',
                    data: { sessionId: 'sess-42', mountedAt: 1700000000 },
                },
            ],
            cursor: 'c1',
        });
        const httpGet = mock((_url: string) => ({
            ok: true,
            status: 200,
            body,
            contentType: 'application/json',
        }));
        (globalThis as GlobalWithRuntime).OnlookRuntime = { httpGet };

        const handle = startOverlayAckPoll({
            relayHost: 'http://relay/manifest/abc',
            sessionId: 'sess-42',
            onEvent: (e) => received.push(e),
        });
        expect(handle.installed).toBe(true);
        // initial poll runs synchronously
        expect(httpGet).toHaveBeenCalledTimes(1);
        const firstUrl = httpGet.mock.calls[0]?.[0] as string;
        expect(firstUrl).toContain('/events');
        expect(firstUrl).toContain('session=sess-42');
        expect(received.length).toBe(1);
        expect(received[0]?.id).toBe('e1');
        expect(handle.getCursor()).toBe('c1');
        handle.stop();
    });

    test('invalid event payloads surface via onError and are NOT dispatched', () => {
        const received: RelayEvent[] = [];
        const errs: Error[] = [];
        const body = JSON.stringify({
            events: [{ id: 'bad', type: 'overlayAck', data: { ok: true } }], // missing sessionId + mountedAt
            cursor: 'c1',
        });
        const httpGet = mock((_url: string) => ({
            ok: true,
            status: 200,
            body,
            contentType: 'application/json',
        }));
        (globalThis as GlobalWithRuntime).OnlookRuntime = { httpGet };

        const handle = startOverlayAckPoll({
            relayHost: 'http://relay',
            sessionId: 's',
            onEvent: (e) => received.push(e),
            onError: (e) => errs.push(e),
        });
        expect(received.length).toBe(0);
        expect(errs.length).toBe(1);
        expect(errs[0]?.message).toContain('invalid event');
        handle.stop();
    });

    test('validate:false dispatches raw events without schema checks', () => {
        const received: RelayEvent[] = [];
        const body = JSON.stringify({
            events: [{ id: 'raw', type: 'arbitrary', data: { anything: 42 } }],
            cursor: 'c1',
        });
        const httpGet = mock((_url: string) => ({
            ok: true,
            status: 200,
            body,
            contentType: 'application/json',
        }));
        (globalThis as GlobalWithRuntime).OnlookRuntime = { httpGet };

        const handle = startOverlayAckPoll({
            relayHost: 'http://relay',
            sessionId: 's',
            onEvent: (e) => received.push(e),
            validate: false,
        });
        expect(received.length).toBe(1);
        expect(received[0]?.type).toBe('arbitrary');
        handle.stop();
    });

    test('derives /events from a manifest-style relayHost', () => {
        const httpGet = mock(() => ({
            ok: true,
            status: 200,
            body: '{"events":[],"cursor":"c1"}',
            contentType: 'application/json',
        }));
        (globalThis as GlobalWithRuntime).OnlookRuntime = { httpGet };

        const handle = startOverlayAckPoll({
            relayHost: 'http://192.168.0.17:18999/manifest/' + 'a'.repeat(64),
            sessionId: 's',
            onEvent: () => {},
        });
        const firstUrl = httpGet.mock.calls[0]?.[0] as string;
        expect(firstUrl.startsWith('http://192.168.0.17:18999/events')).toBe(true);
        handle.stop();
    });

    test('onError fires when relay returns non-ok', () => {
        const errs: Error[] = [];
        const httpGet = mock(() => ({
            ok: false,
            status: 500,
            body: '',
            contentType: 'text/plain',
        }));
        (globalThis as GlobalWithRuntime).OnlookRuntime = { httpGet };
        const handle = startOverlayAckPoll({
            relayHost: 'http://relay',
            sessionId: 's',
            onEvent: () => {},
            onError: (e) => errs.push(e),
        });
        expect(errs.length).toBe(1);
        handle.stop();
    });
});

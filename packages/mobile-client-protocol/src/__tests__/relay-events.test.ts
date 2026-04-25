import { describe, expect, test } from 'bun:test';

import {
    BundleUpdateEventSchema,
    KeepAliveEventSchema,
    OverlayAckEventSchema,
    OverlayErrorEventSchema,
    OverlayMountedEventSchema,
    RelayEventSchema,
    RelayEventsResponseSchema,
    assertNeverRelayEvent,
    parseRelayEvent,
} from '../relay-events';

// `as const` on the `type` field preserves the literal-type narrowing that
// the discriminated-union schemas need — without it, TypeScript widens the
// fixture's type to `string` and expect(...).toEqual(fixture) fails to
// match the schema's narrower literal type.
const validAck = {
    id: 'e1',
    type: 'overlayAck' as const,
    data: { sessionId: 'sess', mountedAt: 1700000000 },
};

const validBundleUpdate = {
    id: 'e2',
    type: 'bundleUpdate' as const,
    data: {
        sessionId: 'sess',
        bundleUrl: 'https://relay.example.com/bundles/abc.js',
        onlookRuntimeVersion: '1.0.0',
        timestamp: 1700000001,
    },
};

const validMounted = {
    id: 'e3',
    type: 'overlayMounted' as const,
    data: { sessionId: 'sess', mountedAt: 1700000002 },
};

const validError = {
    id: 'e4',
    type: 'overlayError' as const,
    data: {
        sessionId: 'sess',
        message: 'TypeError: x is not a function',
        stack: 'at foo (bundle:10:5)',
        timestamp: 1700000003,
    },
};

const validKeepAlive = {
    id: 'e5',
    type: 'keepAlive' as const,
    data: { timestamp: 1700000004 },
};

describe('individual event schemas', () => {
    test('OverlayAckEvent accepts a valid payload', () => {
        expect(OverlayAckEventSchema.parse(validAck)).toEqual(validAck);
    });

    test('OverlayAckEvent accepts an optional ackId', () => {
        const withAckId = {
            ...validAck,
            data: { ...validAck.data, ackId: 'ack-xyz' },
        };
        expect(OverlayAckEventSchema.parse(withAckId).data.ackId).toBe('ack-xyz');
    });

    test('OverlayAckEvent rejects missing sessionId', () => {
        expect(() =>
            OverlayAckEventSchema.parse({
                id: 'e',
                type: 'overlayAck',
                data: { mountedAt: 1 },
            }),
        ).toThrow();
    });

    test('BundleUpdateEvent rejects non-URL bundleUrl', () => {
        expect(() =>
            BundleUpdateEventSchema.parse({
                ...validBundleUpdate,
                data: { ...validBundleUpdate.data, bundleUrl: 'not-a-url' },
            }),
        ).toThrow();
    });

    test('OverlayMountedEvent validates minimal payload', () => {
        expect(OverlayMountedEventSchema.parse(validMounted)).toEqual(validMounted);
    });

    test('OverlayErrorEvent allows stack to be absent', () => {
        const { stack: _stack, ...dataNoStack } = validError.data;
        const withoutStack = { ...validError, data: dataNoStack };
        expect(OverlayErrorEventSchema.parse(withoutStack).data.stack).toBeUndefined();
    });

    test('KeepAliveEvent requires timestamp', () => {
        expect(() =>
            KeepAliveEventSchema.parse({ id: 'e', type: 'keepAlive', data: {} }),
        ).toThrow();
    });
});

describe('RelayEvent discriminated union', () => {
    test('accepts every event kind', () => {
        for (const ev of [validAck, validBundleUpdate, validMounted, validError, validKeepAlive]) {
            expect(RelayEventSchema.parse(ev).type).toBe(ev.type);
        }
    });

    test('rejects unknown type variants', () => {
        const bogus = { id: 'x', type: 'unknownKind', data: {} };
        expect(() => RelayEventSchema.parse(bogus)).toThrow();
    });

    test('rejects an event missing its id', () => {
        expect(() =>
            RelayEventSchema.parse({
                type: 'keepAlive',
                data: { timestamp: 0 },
            }),
        ).toThrow();
    });
});

describe('RelayEventsResponse', () => {
    test('accepts an empty events array', () => {
        const parsed = RelayEventsResponseSchema.parse({ events: [], cursor: 'c0' });
        expect(parsed.events).toEqual([]);
        expect(parsed.cursor).toBe('c0');
    });

    test('cursor is optional', () => {
        const parsed = RelayEventsResponseSchema.parse({ events: [] });
        expect(parsed.cursor).toBeUndefined();
    });

    test('validates a mixed-kind events array', () => {
        const parsed = RelayEventsResponseSchema.parse({
            events: [validAck, validKeepAlive, validBundleUpdate],
            cursor: 'c3',
        });
        expect(parsed.events.map((e) => e.type)).toEqual([
            'overlayAck',
            'keepAlive',
            'bundleUpdate',
        ]);
    });

    test('rejects a response with a single invalid event', () => {
        expect(() =>
            RelayEventsResponseSchema.parse({
                events: [validAck, { id: 'bad', type: 'nope', data: {} }],
            }),
        ).toThrow();
    });
});

describe('parseRelayEvent', () => {
    test('returns {ok:true, event} on success', () => {
        const res = parseRelayEvent(validAck);
        expect(res.ok).toBe(true);
        if (res.ok) expect(res.event.type).toBe('overlayAck');
    });

    test('returns {ok:false, error} on validation failure', () => {
        const res = parseRelayEvent({ id: 'e', type: 'nope', data: {} });
        expect(res.ok).toBe(false);
        if (!res.ok) expect(res.error.length).toBeGreaterThan(0);
    });

    test('returns {ok:false, error} when input is not an object', () => {
        expect(parseRelayEvent('string').ok).toBe(false);
        expect(parseRelayEvent(42).ok).toBe(false);
        expect(parseRelayEvent(null).ok).toBe(false);
    });
});

describe('assertNeverRelayEvent', () => {
    test('throws when called with an unhandled variant', () => {
        expect(() => assertNeverRelayEvent({ weird: true } as unknown as never)).toThrow(
            /Unhandled RelayEvent/,
        );
    });
});

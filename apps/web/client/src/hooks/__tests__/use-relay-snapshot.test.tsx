/**
 * Tests for useRelaySnapshot — the rAF-throttled subscription to a
 * RelayWsClient's snapshot. Uses a synchronous fake rAF so the effect
 * runs deterministically under bun:test (real rAF would schedule via
 * the microtask queue + render loop, neither of which exist here).
 */
import { describe, expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { act } from 'react';

import type {
    RelayMessageSnapshot,
    RelayWsClient,
} from '@/services/expo-relay/relay-ws-client';

import { useRelaySnapshot } from '../use-relay-snapshot';

/**
 * Minimal client stub — only the `snapshot()` surface is used by the
 * hook. Tests drive mutations by returning different snapshots on
 * subsequent calls.
 */
function makeStubClient(snaps: RelayMessageSnapshot[]): RelayWsClient {
    let idx = 0;
    return {
        snapshot: () => {
            const s = snaps[Math.min(idx, snaps.length - 1)]!;
            idx += 1;
            return s;
        },
    } as unknown as RelayWsClient;
}

const EMPTY_SNAP: RelayMessageSnapshot = {
    messages: [],
    acks: [],
    state: 'idle',
};

describe('useRelaySnapshot', () => {
    test('returns null when client is null', () => {
        function Probe() {
            const snap = useRelaySnapshot(null);
            return <div data-testid="probe" data-has-snap={snap !== null ? 'y' : 'n'} />;
        }
        const markup = renderToStaticMarkup(<Probe />);
        expect(markup).toContain('data-has-snap="n"');
    });

    test('returns the initial snapshot synchronously via useState init', () => {
        // useState(() => client.snapshot()) runs eagerly — the first
        // render SHOULD have the seed snapshot, not null, so consumers
        // don't briefly render an empty panel on mount.
        const client = makeStubClient([EMPTY_SNAP]);
        function Probe() {
            const snap = useRelaySnapshot(client);
            return (
                <div
                    data-testid="probe"
                    data-state={snap?.state ?? 'none'}
                    data-messages={(snap?.messages?.length ?? -1).toString()}
                />
            );
        }
        const markup = renderToStaticMarkup(<Probe />);
        expect(markup).toContain('data-state="idle"');
        expect(markup).toContain('data-messages="0"');
    });
});

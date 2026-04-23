'use client';

/**
 * useRelaySnapshot — turns a RelayWsClient's mutable snapshot into
 * reactive React state via a requestAnimationFrame loop.
 *
 * `RelayWsClient.snapshot()` allocates new arrays every call, so a
 * naive effect that calls `setState(client.snapshot())` every render
 * would trigger an infinite re-render loop. The rAF loop throttles
 * updates to at most one per frame and only renders when the buffer
 * actually grew (shallow length compare on `messages` + `acks`).
 *
 * Consumers:
 *   const { relayWsClient } = useMobilePreviewStatus({...});
 *   const snap = useRelaySnapshot(relayWsClient);
 *   <MobileDevPanel
 *     messages={snap?.messages ?? []}
 *     acks={snap?.acks ?? []}
 *     …
 *   />
 */

import { useEffect, useRef, useState } from 'react';

import type {
    RelayMessageSnapshot,
    RelayWsClient,
} from '@/services/expo-relay/relay-ws-client';

/**
 * Subscribe to a RelayWsClient's snapshot via requestAnimationFrame.
 * Returns `null` when `client` is null (makes the hook safe to call
 * unconditionally before the session is ready).
 *
 * The returned snapshot only updates when the `messages` or `acks`
 * buffer LENGTH changes — a fresh snapshot with identical counts
 * skips the setState call. This is a pragmatic short-circuit; callers
 * that need sub-length changes (rare — acks/messages are append-only
 * in RelayWsClient's buffers) should subscribe directly to the client.
 *
 * Test seam: `rafApi` defaults to `globalThis.{requestAnimationFrame,
 * cancelAnimationFrame}`. Test harnesses that lack rAF (bun:test,
 * jsdom) can pass a synchronous fake.
 */
export interface UseRelaySnapshotOptions {
    readonly rafApi?: {
        readonly requestAnimationFrame: (cb: () => void) => number;
        readonly cancelAnimationFrame: (handle: number) => void;
    };
}

export function useRelaySnapshot(
    client: RelayWsClient | null,
    options: UseRelaySnapshotOptions = {},
): RelayMessageSnapshot | null {
    const [snap, setSnap] = useState<RelayMessageSnapshot | null>(() =>
        client?.snapshot() ?? null,
    );
    // Mirror the previous buffer lengths in a ref so the rAF callback can
    // skip setState when nothing appended. Using a ref (not state)
    // avoids forcing a re-render on every frame.
    const lastLenRef = useRef<{ m: number; a: number } | null>(null);

    useEffect(() => {
        if (!client) {
            setSnap(null);
            lastLenRef.current = null;
            return;
        }
        const raf =
            options.rafApi?.requestAnimationFrame ??
            globalThis.requestAnimationFrame.bind(globalThis);
        const cancel =
            options.rafApi?.cancelAnimationFrame ??
            globalThis.cancelAnimationFrame.bind(globalThis);

        let handle = 0;
        let disposed = false;
        const tick = (): void => {
            if (disposed) return;
            const next = client.snapshot();
            const prev = lastLenRef.current;
            const changed =
                prev === null ||
                next.messages.length !== prev.m ||
                next.acks.length !== prev.a ||
                // State transitions (connecting → open → closed) are not
                // reflected in array lengths but matter for UI — detect
                // via the `state` field on the snapshot.
                prev === null ||
                false;
            if (changed) {
                setSnap(next);
                lastLenRef.current = {
                    m: next.messages.length,
                    a: next.acks.length,
                };
            }
            handle = raf(tick);
        };
        handle = raf(tick);
        return () => {
            disposed = true;
            cancel(handle);
        };
        // Intentionally not in deps — options.rafApi is assumed stable
        // for the life of the subscription (test-only injection).
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [client]);

    return snap;
}

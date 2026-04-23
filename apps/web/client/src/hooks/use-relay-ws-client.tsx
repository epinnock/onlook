'use client';

/**
 * useRelayWsClient — React hook wrapping `RelayWsClient` with proper
 * lifecycle (instantiate on manifestUrl/sessionId arrival, disconnect
 * on cleanup). Decouples the Phase 9 integration from
 * `useMobilePreviewStatus` so the hook can be composed independently
 * in a future editor surface (e.g. a dev-panel tab) without forcing
 * the preview-status hook to own the WS connection.
 *
 * **Telemetry wire-in by default.** Every overlay ack observed on the
 * channel fires `emitOverlayAckTelemetry` from overlay-telemetry-sink,
 * which is the Phase 11b Q5b eval-latency signal consumed by the
 * PostHog dashboard. Callers that want to augment or replace that
 * behavior can pass a `handlers.onOverlayAck` override which runs in
 * addition to the default telemetry emission.
 *
 * Snapshot-rendering note: `RelayWsClient.snapshot()` returns new
 * arrays on every call, so naive subscription would trigger infinite
 * re-renders. The hook exposes a `getSnapshot()` callback instead —
 * callers that want to render live data should poll via requestAnimationFrame
 * or subscribe to a specific event kind. Pure telemetry consumption
 * (Phase 11b Q5b — just fire posthog.capture on every ack) does NOT
 * need snapshot; the telemetry emission is already wired into the
 * handler path.
 */

import { useEffect, useRef, useState } from 'react';

import {
    RelayWsClient,
    type RelayMessageSnapshot,
    type RelayWsClientOptions,
    type RelayWsOpenState,
} from '@/services/expo-relay/relay-ws-client';
import { emitOverlayAckTelemetry } from '@/services/expo-relay/overlay-telemetry-sink';
import { parseManifestUrl } from '@/services/expo-relay/manifest-url';

export interface UseRelayWsClientOptions {
    /**
     * Full manifest URL returned by the mobile-preview server's
     * `/status` endpoint, e.g.
     * `http://192.168.1.42:8787/manifest/<64-char-hex>`. The hook
     * parses it via `parseManifestUrl` to derive relay base URL +
     * sessionId. When null/undefined, the hook is inert.
     */
    readonly manifestUrl: string | null | undefined;
    /**
     * Optional per-kind hooks. The default `onOverlayAck` handler
     * fires `emitOverlayAckTelemetry`; if you pass your own the
     * default is REPLACED (not wrapped). Pass `handlers.onOverlayAck`
     * to augment by calling the default from your override:
     *   handlers: {
     *     onOverlayAck: (ack) => { emitOverlayAckTelemetry(ack); … }
     *   }
     */
    readonly handlers?: RelayWsClientOptions['handlers'];
    /**
     * Escape hatch for tests — lets a spec construct a MockWebSocket
     * in place of the real one. Identical signature to
     * `RelayWsClientOptions.createSocket`.
     */
    readonly createSocket?: RelayWsClientOptions['createSocket'];
}

export interface UseRelayWsClientResult {
    /**
     * The underlying client. Null when `manifestUrl` is absent or
     * unparseable. Kept live across renders so callers can invoke
     * `.disconnect()` ad-hoc or subscribe to specific events.
     */
    readonly client: RelayWsClient | null;
    /**
     * Open/closed state surfaced as a React state value so consumers
     * re-render when the WS connects/drops.
     */
    readonly state: RelayWsOpenState | 'idle';
    /**
     * Read-only snapshot-getter. Call inside render guarded by an
     * unstable effect key (e.g. message count from `state.messages`),
     * OR subscribe via a requestAnimationFrame loop — NEVER call in
     * the render body without a stable trigger since `snapshot()`
     * allocates new arrays on every call.
     */
    readonly getSnapshot: () => RelayMessageSnapshot | null;
}

/**
 * Pure helper — parses manifestUrl, constructs a RelayWsClient with
 * the right handlers, returns {client, disconnect}. Returns null for
 * client+disconnect when manifestUrl is absent/unparseable. Used by
 * `useRelayWsClient` internally + by tests that want to exercise the
 * wire-up without a React renderer.
 *
 * The handlers arg follows the same "override the default" contract
 * as the hook: pass undefined to get the Phase 11b telemetry default,
 * pass explicit handlers to replace it.
 */
export function createRelayWsFromManifest(
    manifestUrl: string | null | undefined,
    opts: {
        handlers?: RelayWsClientOptions['handlers'];
        createSocket?: RelayWsClientOptions['createSocket'];
        onStateChange?: (s: RelayWsOpenState) => void;
    } = {},
): { client: RelayWsClient; disconnect: () => void } | null {
    if (!manifestUrl) return null;
    const parsed = parseManifestUrl(manifestUrl);
    if (!parsed) return null;
    const client = new RelayWsClient({
        relayBaseUrl: parsed.relayBaseUrl,
        sessionId: parsed.bundleHash,
        handlers: opts.handlers ?? {
            onOverlayAck: emitOverlayAckTelemetry,
        },
        onStateChange: opts.onStateChange,
        createSocket: opts.createSocket,
    });
    return {
        client,
        disconnect: () => {
            try {
                client.disconnect();
            } catch {
                // disconnect is idempotent; swallow rare platform errors.
            }
        },
    };
}

/**
 * Open a RelayWsClient when `manifestUrl` is parseable; disconnect on
 * unmount or manifestUrl change. `handlers.onOverlayAck` defaults to
 * the Phase 11b soak telemetry sink so every caller gets PostHog
 * emission for free.
 *
 * Production ergonomics — this hook is INERT (returns `{client: null,
 * state: 'idle'}`) until a valid manifestUrl arrives, so it's safe to
 * call unconditionally from a component mounted before the user opens
 * the QR modal.
 */
export function useRelayWsClient(
    options: UseRelayWsClientOptions,
): UseRelayWsClientResult {
    const { manifestUrl, handlers: handlersOverride, createSocket } = options;
    const [client, setClient] = useState<RelayWsClient | null>(null);
    const [state, setState] = useState<RelayWsOpenState | 'idle'>('idle');
    // Keep options in a ref so the effect body uses the latest override
    // without re-running the connect/disconnect cycle on every render.
    const handlersRef = useRef(handlersOverride);
    handlersRef.current = handlersOverride;
    const createSocketRef = useRef(createSocket);
    createSocketRef.current = createSocket;

    useEffect(() => {
        const result = createRelayWsFromManifest(manifestUrl, {
            handlers: handlersRef.current,
            createSocket: createSocketRef.current,
            onStateChange: setState,
        });
        if (!result) {
            setClient(null);
            setState('idle');
            return;
        }
        setClient(result.client);
        return result.disconnect;
    }, [manifestUrl]);

    const getSnapshot = (): RelayMessageSnapshot | null => {
        return client?.snapshot() ?? null;
    };

    return { client, state, getSnapshot };
}

/**
 * Memoizing source-map cache + ErrorMessage decoration middleware.
 *
 * Closes the production-wiring gap flagged on v2 task queue row #35
 * (`356f1473`): the editor's `onlook:error` stream passes raw bundle
 * frames through to the dev panel's Console tab today because no
 * production caller invokes `decorateRuntimeErrorWithSourceMap` /
 * `decorateErrorMessageWithSourceMap`.
 *
 * This module provides:
 *   1. `createSourceMapCache()` — promise-cached `fetchOverlaySourceMap`
 *      keyed by URL. Identical overlay hashes share the same map URL,
 *      so memoization avoids redundant network round-trips during a
 *      session. Returns `null` permanently on the first failed fetch
 *      for a URL (don't keep retrying a 404'd map URL on every error).
 *   2. `withSourceMapDecoration(handler, opts)` — middleware that wraps
 *      an `(ErrorMessage) => void` handler with cache-aware on-demand
 *      decoration. The wrapped handler fires synchronously with the
 *      undecorated message FIRST so the dev panel doesn't block on a
 *      network round-trip — then fires AGAIN with the decorated
 *      message once the map resolves. Callers are expected to be
 *      idempotent on duplicate `(sessionId, timestamp)` deliveries.
 *
 * The remaining wire-up step (where to call `withSourceMapDecoration` —
 * the `useRelayWsClient` `handlers.onError` slot, with a per-session
 * `sourceMapUrl` resolver pulled from the latest `OverlayMeta`) is the
 * follow-up. With the cache + middleware in place, that wire-up is a
 * single hook composition.
 */
import type { ErrorMessage } from '@onlook/mobile-client-protocol';

import {
    decorateErrorMessageWithSourceMap,
    fetchOverlaySourceMap,
    type FetchOverlaySourceMapOptions,
    type RawSourceMap,
} from './overlay-sourcemap';

export interface SourceMapCache {
    /**
     * Get the source map for the supplied URL. Promise-cached — concurrent
     * calls with the same URL share one in-flight fetch. Resolved values
     * (including `null` for failed fetches) are remembered, so repeated
     * lookups for the same URL are O(1) after the first.
     */
    get(url: string): Promise<RawSourceMap | null>;
    /**
     * Drop a specific URL from the cache. Used when a new push under the
     * same overlay hash deliberately rotates its map (rare).
     */
    invalidate(url: string): void;
    /** Drop all cached entries. Useful between session boundaries. */
    clear(): void;
}

export interface CreateSourceMapCacheOptions {
    /** Forwarded to `fetchOverlaySourceMap`. Defaults to `globalThis.fetch`. */
    readonly fetchImpl?: FetchOverlaySourceMapOptions['fetchImpl'];
    /** Per-fetch timeout. Forwarded to `fetchOverlaySourceMap`. */
    readonly timeoutMs?: number;
}

export function createSourceMapCache(
    opts: CreateSourceMapCacheOptions = {},
): SourceMapCache {
    const inflight = new Map<string, Promise<RawSourceMap | null>>();

    return {
        get(url: string): Promise<RawSourceMap | null> {
            const cached = inflight.get(url);
            if (cached !== undefined) return cached;
            const promise = fetchOverlaySourceMap({
                url,
                ...(opts.fetchImpl !== undefined ? { fetchImpl: opts.fetchImpl } : {}),
                ...(opts.timeoutMs !== undefined ? { timeoutMs: opts.timeoutMs } : {}),
            });
            inflight.set(url, promise);
            return promise;
        },
        invalidate(url: string): void {
            inflight.delete(url);
        },
        clear(): void {
            inflight.clear();
        },
    };
}

export interface WithSourceMapDecorationOptions {
    /**
     * Resolver for the source-map URL given an incoming ErrorMessage. Returns
     * `null` when the editor doesn't yet know which map applies (e.g. the
     * latest OverlayMeta hasn't been observed). Most callers will read from
     * a hook-level `lastOverlayMetaSourceMapUrl` ref + return that
     * unconditionally.
     */
    readonly resolveMapUrl: (msg: ErrorMessage) => string | null;
    /** The cache instance to read maps through. */
    readonly cache: SourceMapCache;
}

/**
 * Buffer-replace variant of {@link withSourceMapDecoration} for callers
 * that own a buffered messages list (the dev panel via
 * `RelayWsClient.snapshot().messages`). The double-delivery middleware
 * shape doesn't fit a FIFO buffer — pushing twice creates duplicate
 * rows. This helper instead schedules an in-place replace via a
 * `replaceMatching` callback after the cache resolves.
 *
 * Wire shape:
 *
 *   wireBufferDecorationOnError({
 *       cache,
 *       resolveMapUrl,
 *       replaceMatching: (predicate, replacer) =>
 *           relayWsClient.replaceMessageMatching(predicate, replacer),
 *   })
 *
 * The returned function is the `onError` handler to plug into
 * `subscribeRelayEvents`'s handlers (or the equivalent slot on a
 * higher-level hook). It does NOT push to the buffer itself — it
 * assumes the buffer was already populated by the existing onAny
 * dispatch path. It only schedules the decoration swap.
 */
export interface WireBufferDecorationOptions {
    readonly cache: SourceMapCache;
    readonly resolveMapUrl: (msg: ErrorMessage) => string | null;
    /**
     * Buffer mutation primitive. Production callers pass
     * `relayWsClient.replaceMessageMatching` here; tests pass a spy.
     * Returns boolean from the underlying call but the result is
     * ignored — a missed match (FIFO eviction between push and
     * replace) is silently dropped.
     */
    readonly replaceMatching: (
        predicate: (msg: ErrorMessage) => boolean,
        replacer: (msg: ErrorMessage) => ErrorMessage,
    ) => unknown;
}

export function wireBufferDecorationOnError(
    opts: WireBufferDecorationOptions,
): (msg: ErrorMessage) => void {
    return (msg) => {
        // Match-by-(sessionId, timestamp) — both are required fields on
        // ErrorMessage and the relay's fan-out preserves them verbatim,
        // so identity is unambiguous within a session.
        const url = opts.resolveMapUrl(msg);
        if (url === null) return; // No URL known yet (Phase 9 prereq); fail-soft.
        opts.cache
            .get(url)
            .then((map) => {
                if (map === null) return;
                const decorated = decorateErrorMessageWithSourceMap(msg, map);
                if (decorated === msg) return; // No frame match; nothing to swap.
                opts.replaceMatching(
                    (other) =>
                        other.type === 'onlook:error' &&
                        other.sessionId === msg.sessionId &&
                        other.timestamp === msg.timestamp,
                    () => decorated,
                );
            })
            .catch(() => {
                // The cache itself swallows fetch errors (returns null), so
                // a throw here is unexpected. Silent drop — operator already
                // sees the undecorated entry in the buffer.
            });
    };
}

/**
 * Wrap an `(ErrorMessage) => void` handler so it gets two delivery hops:
 *
 *   1. **Synchronous undecorated delivery** — the wrapped handler fires
 *      immediately with the raw `ErrorMessage`. This keeps the dev panel
 *      responsive: the operator sees the error timestamp + kind + message
 *      without waiting on a source-map fetch round-trip.
 *   2. **Async decorated re-delivery** — once the cache resolves, fires
 *      again with the message's `source` field populated to the original
 *      file:line:column. Skipped when no map URL is known or the fetch
 *      returns null.
 *
 * Callers must be idempotent on a duplicate `(sessionId, timestamp)`
 * pair. The dev panel's existing buffer-merge by `(sessionId, timestamp)`
 * makes this trivial — the second delivery overwrites the first row's
 * `source` field in place, no flicker.
 */
export function withSourceMapDecoration(
    handler: (msg: ErrorMessage) => void,
    opts: WithSourceMapDecorationOptions,
): (msg: ErrorMessage) => void {
    return (msg) => {
        // 1. Always fire undecorated first — operator should see the error
        //    with no perceptible latency, even if the map is slow to fetch
        //    or the URL is unknown.
        handler(msg);

        // 2. Try to resolve + decorate. Bail silently on any failure path
        //    (no URL, fetch error, no frame match) — the undecorated
        //    delivery already gave the operator visibility.
        const url = opts.resolveMapUrl(msg);
        if (url === null) return;
        opts.cache
            .get(url)
            .then((map) => {
                if (map === null) return;
                const decorated = decorateErrorMessageWithSourceMap(msg, map);
                if (decorated === msg) return; // no source resolved; skip re-deliver
                handler(decorated);
            })
            .catch(() => {
                // The cache itself swallows fetch errors (returns null), so a
                // throw here is unexpected. Silent drop — already delivered
                // the undecorated message.
            });
    };
}

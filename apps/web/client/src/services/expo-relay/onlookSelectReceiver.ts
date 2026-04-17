/**
 * Editor-side receiver for `onlook:select` messages (MC4.15).
 *
 * The mobile client's `TapHandler` (MC4.14) posts a schema-valid
 * `SelectMessage` over the relay WebSocket whenever the user taps a
 * component on the device. The relay forwards that message to the
 * editor session, where this module fans it out to subscribers —
 * most importantly the Monaco cursor-jump handler (MC4.17).
 *
 * At MC4.15 time, the editor does not yet own a dedicated WebSocket
 * plumbing layer (the dev-panel tabs consume pre-collected
 * `WsMessage[]` via props — see `MobileNetworkTab.tsx` /
 * `MobileConsoleTab.tsx`). The transport layer arrives with MC4.16
 * (router registration + server entrypoint). To keep this task small
 * and let MC4.16/MC4.17 compose cleanly, we ship a minimal in-process
 * pub-sub here using `EventTarget`. The eventual WS pump (MC4.16) and
 * any other producer just calls `dispatchOnlookSelect(message)` — all
 * registered handlers fire synchronously in registration order.
 *
 * Public surface:
 *   - `OnlookSelectMessage` — the flat shape handlers consume. Flat
 *     rather than nested (see `SelectMessage` in the protocol package)
 *     because the Monaco cursor-jump consumer (MC4.17) only needs
 *     `fileName`/`lineNumber`/`columnNumber` and an ISO timestamp for
 *     logging. Normalization from the wire format happens here so
 *     every downstream handler gets the same shape.
 *   - `registerOnlookSelectHandler(handler)` — subscribe, returns an
 *     unsubscribe function.
 *   - `dispatchOnlookSelect(payload)` — forward an incoming message.
 *     Accepts either the flat `OnlookSelectMessage` (for tests and
 *     callers that already normalized) or the wire-format
 *     `{ type: 'onlook:select', source: {...} }` (for the eventual
 *     WS pump in MC4.16). Malformed payloads are silently ignored.
 */

/**
 * The message shape delivered to registered handlers. This is
 * deliberately flat: MC4.17's Monaco cursor-jump consumer only needs
 * the file and position. The `timestamp` is an ISO-8601 string (the
 * wire schema carries a number timestamp; we normalize).
 */
export interface OnlookSelectMessage {
    type: 'onlook:select';
    fileName: string;
    lineNumber: number;
    columnNumber: number;
    timestamp: string;
}

/** Subscriber callback signature. */
export type OnlookSelectHandler = (msg: OnlookSelectMessage) => void;

/** Internal event name used by the `EventTarget` pub-sub. */
const SELECT_EVENT = 'onlook:select';

/**
 * Module-scoped `EventTarget`. `EventTarget` is available in every
 * runtime the editor targets (Next 16 server components, Node 20
 * test runner, and every modern browser) so we do not need a
 * polyfill. We keep a parallel `Set<unsubscribe>` so that tests can
 * reset global state cleanly without leaking listeners into the next
 * test case.
 */
const bus: EventTarget = new EventTarget();
const activeUnsubscribes: Set<() => void> = new Set();

/**
 * Runtime validator. We cannot import the Zod schema here without
 * pulling the protocol package into every consumer — and this module
 * is deliberately transport-agnostic. A hand-rolled type guard is
 * cheap, covers the fields we need, and keeps the bundle small.
 *
 * Accepts two shapes:
 *   1. Wire format (from the protocol): `{ type: 'onlook:select',
 *      source: { fileName, lineNumber, columnNumber }, timestamp?: number }`.
 *   2. Flat editor format (what handlers receive): the fields are on
 *      the top-level object directly. Lets callers that already
 *      normalized (e.g. unit tests) dispatch without reconstructing
 *      the nested envelope.
 *
 * Returns the normalized `OnlookSelectMessage` or `null` when invalid.
 */
export function normalizeOnlookSelect(raw: unknown): OnlookSelectMessage | null {
    if (raw === null || typeof raw !== 'object') return null;
    const obj = raw as Record<string, unknown>;
    if (obj.type !== 'onlook:select') return null;

    // Prefer nested `source` when present (wire format), fall back to
    // top-level fields (already-flattened caller).
    const nested = obj.source;
    const src: Record<string, unknown> =
        nested !== undefined && nested !== null && typeof nested === 'object'
            ? (nested as Record<string, unknown>)
            : obj;

    const { fileName, lineNumber, columnNumber } = src;
    if (typeof fileName !== 'string' || fileName.length === 0) return null;
    if (typeof lineNumber !== 'number' || !Number.isFinite(lineNumber) || lineNumber <= 0) {
        return null;
    }
    if (
        typeof columnNumber !== 'number' ||
        !Number.isFinite(columnNumber) ||
        columnNumber < 0
    ) {
        return null;
    }

    // Timestamp normalization: accept ISO string (flat form), epoch
    // number (wire form), or synthesize one when missing.
    const rawTs = obj.timestamp;
    let timestamp: string;
    if (typeof rawTs === 'string' && rawTs.length > 0) {
        timestamp = rawTs;
    } else if (typeof rawTs === 'number' && Number.isFinite(rawTs) && rawTs >= 0) {
        timestamp = new Date(rawTs).toISOString();
    } else {
        timestamp = new Date().toISOString();
    }

    return {
        type: 'onlook:select',
        fileName,
        lineNumber,
        columnNumber,
        timestamp,
    };
}

/**
 * Register a handler for incoming `onlook:select` messages.
 *
 * Multiple handlers can be registered; each fires once per dispatch
 * in registration order.
 *
 * @returns An unsubscribe function. Idempotent — calling it twice is
 *   a no-op on the second call.
 */
export function registerOnlookSelectHandler(
    handler: OnlookSelectHandler,
): () => void {
    const listener = (event: Event): void => {
        const detail = (event as CustomEvent<OnlookSelectMessage>).detail;
        if (detail === undefined) return;
        handler(detail);
    };

    bus.addEventListener(SELECT_EVENT, listener);

    let removed = false;
    const unsubscribe = (): void => {
        if (removed) return;
        removed = true;
        bus.removeEventListener(SELECT_EVENT, listener);
        activeUnsubscribes.delete(unsubscribe);
    };
    activeUnsubscribes.add(unsubscribe);
    return unsubscribe;
}

/**
 * Dispatch an `onlook:select` message to every registered handler.
 *
 * Called by the editor's WebSocket pump (MC4.16) when a
 * `SelectMessage` arrives from the relay, and by unit tests that want
 * to exercise the cursor-jump flow (MC4.17) without a live socket.
 *
 * Malformed payloads are silently dropped (reported via the optional
 * `onInvalid` hook). We never throw from here because a bad message
 * must not crash the editor — in the worst case the user just sees
 * a tap that did nothing.
 *
 * @returns `true` if the payload was valid and dispatched, `false`
 *   otherwise.
 */
export function dispatchOnlookSelect(
    raw: unknown,
    opts?: { onInvalid?: (raw: unknown) => void },
): boolean {
    const msg = normalizeOnlookSelect(raw);
    if (msg === null) {
        opts?.onInvalid?.(raw);
        return false;
    }
    bus.dispatchEvent(
        new CustomEvent<OnlookSelectMessage>(SELECT_EVENT, { detail: msg }),
    );
    return true;
}

/**
 * Test-only helper. Removes every listener currently attached to the
 * bus. Exported (via the double-underscore convention) so unit tests
 * can isolate cases without leaking handlers across the file. Calling
 * this in production code is a bug.
 */
export function __resetOnlookSelectReceiverForTests(): void {
    // Snapshot first: each unsubscribe mutates the backing `Set`.
    const snapshot = Array.from(activeUnsubscribes);
    for (const u of snapshot) u();
}

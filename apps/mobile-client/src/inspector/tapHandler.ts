/**
 * JS-side tap handler — reads `__source` metadata injected by MC4.12's
 * Sucrase `jsx-source` transform off tapped React elements and posts an
 * `onlook:select` message over the relay WebSocket (MC3.13).
 *
 * `__source` has the shape `{ fileName: string, lineNumber: number,
 * columnNumber: number }`. The transform emits it on every
 * `React.createElement` call in dev builds (`target: 'onlook-client' &&
 * isDev`) — see `packages/browser-metro/src/host/sucrase-jsx-source.ts`.
 *
 * This handler is platform-agnostic. The actual gesture binding (tap
 * coordinates → React element + props lookup) lives outside this module —
 * typically in the native `OnlookRuntime` bridge or an RN
 * `GestureResponder` overlay. That call-site extracts `props.__source`,
 * then invokes `handleTap()` with the parsed source (or `null` if no
 * `__source` is present on the tapped element).
 *
 * Wire format: conforms to `SelectMessageSchema` from
 * `@onlook/mobile-client-protocol`:
 *
 *   { type: 'onlook:select', sessionId, reactTag, source: { fileName,
 *     lineNumber, columnNumber } }
 *
 * Task: MC4.14
 * Deps: MC4.12 (Sucrase jsx-source), MC3.13 (relay WS client), MCF5 (protocol)
 */

import type { SelectMessage } from '@onlook/mobile-client-protocol';
import type { OnlookRelayClient } from '../relay/wsClient';

/**
 * Parsed `__source` metadata as injected by the `jsx-source` transform.
 *
 * Fields mirror the React DevTools convention:
 *   - `fileName`     — absolute or project-relative path of the JSX source file.
 *   - `lineNumber`   — 1-based line where the JSX open-tag `<` appears.
 *   - `columnNumber` — 1-based column where the JSX open-tag `<` appears.
 */
export interface TapSource {
    fileName: string;
    lineNumber: number;
    columnNumber: number;
}

/** Callback type for local tap listeners (e.g. dev overlays). */
export type TapListener = (source: TapSource) => void;

/** Constructor options. */
export interface TapHandlerOptions {
    /**
     * Session id stamped on every outgoing `onlook:select` message. Can be
     * updated later via {@link TapHandler.setSessionId} once the launch
     * flow has resolved the real id. Defaults to `'unknown'` so the handler
     * is safe to construct before the session handshake completes.
     */
    sessionId?: string;
    /**
     * Optional callback for emitting warnings. Defaults to `console.warn`.
     * Exposed so tests (and production logging hooks) can capture warnings
     * without stubbing the global console.
     */
    warn?: (message: string, detail?: unknown) => void;
}

/**
 * Type-guard — narrows an unknown value to {@link TapSource}.
 *
 * Accepts the exact shape emitted by the jsx-source transform:
 *   `{ fileName: string, lineNumber: number (>0), columnNumber: number (>=0) }`.
 *
 * Returns `false` for any missing or malformed field.
 */
function isTapSource(value: unknown): value is TapSource {
    if (value === null || typeof value !== 'object') return false;
    const obj = value as Record<string, unknown>;
    if (typeof obj.fileName !== 'string' || obj.fileName.length === 0) return false;
    if (typeof obj.lineNumber !== 'number' || !Number.isInteger(obj.lineNumber) || obj.lineNumber <= 0) {
        return false;
    }
    if (
        typeof obj.columnNumber !== 'number' ||
        !Number.isInteger(obj.columnNumber) ||
        obj.columnNumber < 0
    ) {
        return false;
    }
    return true;
}

/**
 * Read `props.__source` off a React element's props and return it as a
 * {@link TapSource}, or `null` if the props are missing/malformed.
 *
 * Designed for the call pattern:
 *   const src = extractSource(node.memoizedProps);
 *   tapHandler.handleTap(src);
 */
export function extractSource(props: unknown): TapSource | null {
    if (props === null || typeof props !== 'object') return null;
    const src = (props as Record<string, unknown>).__source;
    return isTapSource(src) ? src : null;
}

/**
 * Dispatches inspector taps to the relay WebSocket and to any local
 * listeners (e.g. dev-tools overlays).
 *
 * Call-site pattern:
 *
 *   const handler = new TapHandler(relayClient, { sessionId });
 *   handler.setReactTag(node.reactTag);
 *   handler.handleTap(extractSource(node.memoizedProps));
 *
 * If the tapped element has no `__source` (e.g. a built-in host component
 * that the transform skipped) `handleTap(null)` logs a warning and is a
 * no-op — the WS is not burdened with useless taps.
 */
export class TapHandler {
    private readonly _client: OnlookRelayClient;
    private readonly _warn: (message: string, detail?: unknown) => void;
    private _sessionId: string;
    private _reactTag: number = 0;
    private _listeners = new Set<TapListener>();

    constructor(client: OnlookRelayClient, options: TapHandlerOptions = {}) {
        this._client = client;
        this._sessionId = options.sessionId ?? 'unknown';
        this._warn = options.warn ?? ((msg, detail) => {
            if (detail === undefined) {
                console.warn(msg);
            } else {
                console.warn(msg, detail);
            }
        });
    }

    /** Update the session id stamped on outgoing `onlook:select` messages. */
    setSessionId(sessionId: string): void {
        this._sessionId = sessionId;
    }

    /**
     * Set the React reactTag (native view handle) associated with the next
     * tap. The native gesture layer calls this before invoking
     * {@link handleTap} so the outgoing message can be routed back to the
     * right element on the editor side.
     */
    setReactTag(reactTag: number): void {
        this._reactTag = reactTag;
    }

    /**
     * Forward a tap to the relay.
     *
     * - `source` present → constructs a {@link SelectMessage} and calls
     *   `client.send()`. Also fans out to local listeners.
     * - `source` null    → logs a warning and returns; nothing is sent over
     *   the WS.
     *
     * If `client.send()` throws (socket closed between `isConnected` check
     * and the write) the failure is logged via the configured `warn`
     * callback and swallowed — taps are best-effort; the editor side
     * recovers on the next tap once the socket reconnects.
     */
    handleTap(source: TapSource | null): void {
        if (source === null) {
            this._warn('[TapHandler] Ignoring tap — element has no __source metadata');
            return;
        }

        const msg: SelectMessage = {
            type: 'onlook:select',
            sessionId: this._sessionId,
            reactTag: this._reactTag,
            source: {
                fileName: source.fileName,
                lineNumber: source.lineNumber,
                columnNumber: source.columnNumber,
            },
        };

        try {
            this._client.send(msg);
        } catch (err) {
            // Fire-and-forget: a dropped socket is not fatal for taps.
            this._warn('[TapHandler] Failed to send onlook:select', err);
        }

        // Fan out to local listeners regardless of send success — dev-tools
        // overlays want to highlight the tap even if the WS is down.
        for (const listener of this._listeners) {
            listener(source);
        }
    }

    /**
     * Register a listener that fires every time a tap with a valid source
     * is handled. Useful for dev overlays that highlight the tapped
     * element locally.
     *
     * @returns An unsubscribe function that removes the listener.
     */
    onTap(handler: TapListener): () => void {
        this._listeners.add(handler);
        return () => {
            this._listeners.delete(handler);
        };
    }
}

/**
 * Unified phone→editor event listener — task #87.
 *
 * The relay fans out onlook:console, onlook:network, onlook:error,
 * onlook:select, onlook:tap messages to the editor WS (see
 * `apps/cf-expo-relay/src/do/hmr-session.ts`). This module subscribes once
 * and multiplexes them into discrete typed callbacks so each subscriber
 * doesn't have to re-implement the Zod safeParse dance.
 */
import {
    WsMessageSchema,
    OverlayAckMessageSchema,
    type ConsoleMessage,
    type ErrorMessage,
    type NetworkMessage,
    type OverlayAckMessage,
    type SelectMessage,
    type TapMessage,
} from '@onlook/mobile-client-protocol';

export interface RelayEventHandlers {
    readonly onConsole?: (msg: ConsoleMessage) => void;
    readonly onNetwork?: (msg: NetworkMessage) => void;
    readonly onError?: (msg: ErrorMessage) => void;
    readonly onSelect?: (msg: SelectMessage) => void;
    readonly onTap?: (msg: TapMessage) => void;
    /** Explicit phone→editor mount acknowledgement (abi-v1). */
    readonly onOverlayAck?: (msg: OverlayAckMessage) => void;
    /** Fires for every parsed onlook:* message, regardless of kind-specific callbacks. */
    readonly onAny?: (
        msg:
            | ConsoleMessage
            | NetworkMessage
            | ErrorMessage
            | SelectMessage
            | TapMessage
            | OverlayAckMessage,
    ) => void;
    /** Fires when a message parsed as something we don't route here. Non-fatal; for telemetry only. */
    readonly onUnhandled?: (raw: unknown) => void;
    /** Called on Zod parse failure; argument is the raw string. */
    readonly onMalformed?: (raw: string) => void;
}

export interface RelayEventsSubscription {
    readonly cancel: () => void;
}

export interface RelayEventsOptions {
    readonly ws: {
        addEventListener(
            type: 'message',
            listener: (event: { data: string | ArrayBuffer | ArrayBufferView }) => void,
        ): void;
        removeEventListener?(
            type: 'message',
            listener: (event: { data: string | ArrayBuffer | ArrayBufferView }) => void,
        ): void;
    };
    readonly handlers: RelayEventHandlers;
}

/**
 * Wire up a single 'message' listener that multiplexes onlook:* events into
 * the handler callbacks. Returns a subscription object with `cancel()`.
 */
export function subscribeRelayEvents(
    options: RelayEventsOptions,
): RelayEventsSubscription {
    let cancelled = false;

    const listener = (event: { data: string | ArrayBuffer | ArrayBufferView }): void => {
        if (cancelled) return;
        if (typeof event.data !== 'string') return;

        const raw = safeJsonParse(event.data);

        // onlook:overlayAck lives in abi-v1.ts (not in the legacy WS union),
        // so try it first. Fall through to WsMessageSchema for the rest.
        const ackParse = OverlayAckMessageSchema.safeParse(raw);
        if (ackParse.success) {
            options.handlers.onAny?.(ackParse.data);
            options.handlers.onOverlayAck?.(ackParse.data);
            return;
        }

        const parseResult = WsMessageSchema.safeParse(raw);
        if (!parseResult.success) {
            // Could be an overlayUpdate (not our concern here) or malformed.
            if (/\b(onlook:)/.test(event.data)) {
                options.handlers.onMalformed?.(event.data);
            }
            return;
        }

        const msg = parseResult.data;
        options.handlers.onAny?.(msg);

        switch (msg.type) {
            case 'onlook:console':
                options.handlers.onConsole?.(msg);
                return;
            case 'onlook:network':
                options.handlers.onNetwork?.(msg);
                return;
            case 'onlook:error':
                options.handlers.onError?.(msg);
                return;
            case 'onlook:select':
                options.handlers.onSelect?.(msg);
                return;
            case 'onlook:tap':
                options.handlers.onTap?.(msg);
                return;
            default:
                options.handlers.onUnhandled?.(msg);
                return;
        }
    };

    options.ws.addEventListener('message', listener);

    return {
        cancel() {
            cancelled = true;
            options.ws.removeEventListener?.('message', listener);
        },
    };
}

function safeJsonParse(raw: string): unknown {
    try {
        return JSON.parse(raw);
    } catch {
        return null;
    }
}

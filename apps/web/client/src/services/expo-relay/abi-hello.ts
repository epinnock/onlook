/**
 * abiHello handshake — task #17 / two-tier-overlay-v2 Phase 0 task #5.
 *
 * Builds the editor-side `AbiHelloMessage` per ADR-0001 §"ABI version negotiation".
 * The editor sends this immediately after the relay WebSocket opens; the phone
 * sends its own on connect. Both sides use {@link checkAbiCompatibility} (from
 * `@onlook/mobile-client-protocol`) to decide whether to send/accept overlays.
 */
import {
    ABI_VERSION,
    checkAbiCompatibility,
    type AbiHelloMessage,
    type OnlookRuntimeError,
    type RuntimeCapabilities,
} from '@onlook/mobile-client-protocol';

export interface EditorAbiHelloInput {
    readonly sessionId: string;
    /**
     * Runtime capabilities the editor claims it can work with. For editors this
     * is a stub — the real capabilities come from the base manifest the
     * editor has downloaded. Phase 1 fills this in properly.
     */
    readonly capabilities: RuntimeCapabilities;
}

export function buildEditorAbiHello(input: EditorAbiHelloInput): AbiHelloMessage {
    return {
        type: 'abiHello',
        abi: ABI_VERSION,
        sessionId: input.sessionId,
        role: 'editor',
        runtime: input.capabilities,
    };
}

export interface AbiHandshakeOptions {
    readonly ws: {
        send(data: string): void;
        addEventListener(
            type: 'message',
            listener: (event: { data: string | ArrayBuffer | ArrayBufferView }) => void,
        ): void;
    };
    readonly sessionId: string;
    readonly capabilities: RuntimeCapabilities;
    readonly onPhoneHello: (phone: AbiHelloMessage) => void;
    readonly onIncompatible?: (err: OnlookRuntimeError) => void;
}

export interface AbiHandshakeHandle {
    readonly cancel: () => void;
    /**
     * Null until the phone's abiHello arrives. Once present, indicates
     * whether the editor's ABI is compatible with the phone's. Use this in
     * pushOverlayV1 call sites to gate sends.
     */
    readonly compatibility: () => 'unknown' | 'ok' | OnlookRuntimeError;
}

/**
 * Arm the editor side of the abi-hello exchange. Sends the editor's hello
 * immediately, then listens for the phone's hello. Returns a handle the
 * caller can poll or cancel.
 *
 * The relay is expected to fan this message through to the other end. The
 * editor must NOT send overlayUpdate messages until the compatibility check
 * passes — wire that gate at the pushOverlayV1 call site using
 * {@link AbiHandshakeHandle.compatibility}.
 */
export function startEditorAbiHandshake(options: AbiHandshakeOptions): AbiHandshakeHandle {
    let status: 'unknown' | 'ok' | OnlookRuntimeError = 'unknown';
    let cancelled = false;

    const hello = buildEditorAbiHello({
        sessionId: options.sessionId,
        capabilities: options.capabilities,
    });
    options.ws.send(JSON.stringify(hello));

    const listener = (event: { data: string | ArrayBuffer | ArrayBufferView }): void => {
        if (cancelled) return;
        if (typeof event.data !== 'string') return;
        let parsed: unknown;
        try {
            parsed = JSON.parse(event.data);
        } catch {
            return;
        }
        if (!isAbiHello(parsed)) return;
        if (parsed.role !== 'phone') return;
        options.onPhoneHello(parsed);
        const compat = checkAbiCompatibility(ABI_VERSION, parsed.runtime);
        if (compat === null) {
            status = 'ok';
        } else {
            status = compat;
            options.onIncompatible?.(compat);
        }
    };
    options.ws.addEventListener('message', listener);

    return {
        cancel() {
            cancelled = true;
        },
        compatibility() {
            return status;
        },
    };
}

function isAbiHello(value: unknown): value is AbiHelloMessage {
    if (typeof value !== 'object' || value === null) return false;
    const v = value as Record<string, unknown>;
    return (
        v.type === 'abiHello' &&
        v.abi === 'v1' &&
        typeof v.sessionId === 'string' &&
        (v.role === 'editor' || v.role === 'phone') &&
        typeof v.runtime === 'object'
    );
}

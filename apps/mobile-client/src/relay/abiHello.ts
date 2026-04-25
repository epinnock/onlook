/**
 * Phone-side AbiHello builder — Phase 11b pre-flip prep.
 *
 * Mirrors `apps/web/client/src/services/expo-relay/abi-hello.ts::buildEditorAbiHello`
 * so the phone can send its own `AbiHelloMessage` on every WS connect. The
 * editor-side handshake driver (`startEditorAbiHandshake`) listens for a
 * `role: 'phone'` hello to populate `compatibility()`; without a phone-side
 * sender that gate stays `'unknown'` forever, blocking the Phase 11b
 * default-flip checklist (ADR-0009 §"Pre-flip check: phone runtime MUST be
 * v1-capable").
 *
 * Wiring status (2026-04-25):
 *   - This module: builder + tests. Pure; no platform imports.
 *   - Send-on-connect: NOT wired yet. `OnlookRelayClient.send()` accepts
 *     only `WsMessage` (legacy union) — adding AbiHello requires either
 *     extending the union or adding a sibling `sendAbiHello()` method.
 *     Tracked as a follow-up: relay forwarding + phone send-on-open +
 *     reconnect replay must ship together for the gate to actually close.
 *   - Relay forwarding: cf-expo-relay's HmrSession does not currently
 *     route `abiHello` between sides. Adding it is the dependent task.
 *
 * Once those follow-ups land, replace the helper's caller stub at the
 * mobile-client WS connect path with `client.sendAbiHello(buildPhoneAbiHello({…}))`.
 */
import {
    ABI_VERSION,
    type AbiHelloMessage,
    type RuntimeCapabilities,
} from '@onlook/mobile-client-protocol';

export interface PhoneAbiHelloInput {
    readonly sessionId: string;
    /**
     * Capabilities the phone runtime advertises. Includes baseHash (set by
     * the manifest the phone just fetched), rnVersion / expoSdk / platform
     * (from `Platform.constants` + Expo `Constants`), and the alias list
     * the base bundle serves via `OnlookRuntime.require`. Capability
     * collection is a separate concern from message shape; this builder
     * stays pure so the alternative-platform stubs (Android, web preview)
     * can reuse it.
     */
    readonly capabilities: RuntimeCapabilities;
}

/**
 * Produce a phone-role `AbiHelloMessage`. The `role` discriminant is
 * intentionally hardcoded — every caller in `apps/mobile-client/` is
 * the phone. The editor mirror in `apps/web/client/` hardcodes `'editor'`.
 */
export function buildPhoneAbiHello(input: PhoneAbiHelloInput): AbiHelloMessage {
    return {
        type: 'abiHello',
        abi: ABI_VERSION,
        sessionId: input.sessionId,
        role: 'phone',
        runtime: input.capabilities,
    };
}

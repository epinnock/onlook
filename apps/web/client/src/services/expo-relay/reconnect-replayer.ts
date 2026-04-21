/**
 * Phone reconnect replayer — task #82 / two-tier-overlay-v2 Phase 9.
 *
 * The relay automatically replays `last-overlay-v1` to a newly-joined socket
 * (see `cf-expo-relay/src/do/hmr-session.ts::replayLastOverlay`). But if the
 * editor has already built a NEWER overlay since that stored copy — e.g. the
 * user saved a file while the phone was offline — the relay's replay is
 * stale.
 *
 * This module arms an editor-side observer that re-pushes the
 * most-recent known overlay whenever it detects a phone reconnect
 * (`onlook:abiHello` with role=phone arrives AFTER the initial handshake).
 * The re-push supersedes the relay's stale replay because pushOverlayV1
 * always stores into `last-overlay-v1`.
 */
import type {
    AbiHelloMessage,
    OverlayAssetManifest,
} from '@onlook/mobile-client-protocol';

import { pushOverlayV1, type PushOverlayResult } from './push-overlay';

export interface ReconnectReplayerOptions {
    readonly relayBaseUrl: string;
    readonly sessionId: string;
    /**
     * The most recent overlay the editor has successfully built. The replayer
     * captures this by reference — callers can mutate it in place as new
     * overlays are produced without re-arming the replayer.
     */
    readonly latest: {
        code: string | null;
        sourceMap?: string | undefined;
        buildDurationMs?: number | undefined;
        assets?: OverlayAssetManifest | undefined;
    };
    /** Optional override for tests. Defaults to the real `pushOverlayV1`. */
    readonly push?: typeof pushOverlayV1;
}

export interface ReconnectReplayer {
    /**
     * Feed a parsed `abiHello` message through the replayer. Returns the
     * pushOverlayV1 result when a re-push was triggered, `null` otherwise
     * (e.g. first-ever phone hello, no latest overlay yet).
     */
    onAbiHello(message: AbiHelloMessage): Promise<PushOverlayResult | null>;
    /** True once at least one phone hello has been observed in this session. */
    readonly hasSeenPhoneHello: boolean;
}

export function createReconnectReplayer(
    options: ReconnectReplayerOptions,
): ReconnectReplayer {
    const pushImpl = options.push ?? pushOverlayV1;
    let hasSeenPhoneHello = false;

    return {
        get hasSeenPhoneHello() {
            return hasSeenPhoneHello;
        },
        async onAbiHello(message: AbiHelloMessage): Promise<PushOverlayResult | null> {
            if (message.role !== 'phone') return null;

            const firstHello = !hasSeenPhoneHello;
            hasSeenPhoneHello = true;

            // First-ever phone hello — the phone is joining fresh, relay will
            // replay last-overlay-v1 itself. No editor re-push required.
            if (firstHello) return null;

            // Subsequent phone hello in the same editor session = reconnect.
            // Re-push if we have a latest overlay to send.
            if (!options.latest.code) return null;

            return pushImpl({
                relayBaseUrl: options.relayBaseUrl,
                sessionId: options.sessionId,
                overlay: {
                    code: options.latest.code,
                    sourceMap: options.latest.sourceMap,
                    buildDurationMs: options.latest.buildDurationMs ?? 0,
                },
                ...(options.latest.assets ? { assets: options.latest.assets } : {}),
                onTelemetry: null,
            });
        },
    };
}

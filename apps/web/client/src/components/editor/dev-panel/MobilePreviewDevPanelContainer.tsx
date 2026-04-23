'use client';

/**
 * MobilePreviewDevPanelContainer — drop-in composite component that
 * renders `MobileDevPanel` with live data flowing from the Phase 9
 * wire-in chain:
 *
 *   useMobilePreviewStatus      (commit a3dbd5d4)
 *     ↓ relayWsClient
 *   useRelaySnapshot            (commit 47448a33)
 *     ↓ {messages, acks}
 *   MobileDevPanel              (this component)
 *
 * The parent layout decides where to render this — currently no
 * editor surface calls it (see Phase 9 Task A remaining UI work).
 * When a render slot is chosen, this is a one-line drop-in:
 *
 *   <MobilePreviewDevPanelContainer
 *     serverBaseUrl={env.NEXT_PUBLIC_MOBILE_PREVIEW_URL}
 *     fileSystem={branch.fileSystem}
 *     defaultTab="console"
 *   />
 *
 * Separating the composition from the layout slot means whoever
 * lands the editor integration doesn't have to re-derive the hook
 * chain — they pick a tab/pane and drop this component in.
 */
import type { OverlayAckMessage, WsMessage } from '@onlook/mobile-client-protocol';

import { useMobilePreviewStatus } from '@/hooks/use-mobile-preview-status';
import { useRelaySnapshot } from '@/hooks/use-relay-snapshot';
import type { PreflightSummary } from '@/services/expo-relay/preflight-formatter';
import type { MobilePreviewVfs } from '@/services/mobile-preview';

import {
    MobileDevPanel,
    type MobileDevPanelTabKey,
} from './MobileDevPanel';

export interface MobilePreviewDevPanelContainerProps {
    /**
     * Base URL of the mobile-preview HTTP server (typically port
     * 8787 via `NEXT_PUBLIC_MOBILE_PREVIEW_URL`). Passed through to
     * `useMobilePreviewStatus`.
     */
    serverBaseUrl?: string;
    /**
     * Optional file system for the live push loop — see
     * `useMobilePreviewStatus`. When omitted, the WS ingest still
     * works but no overlay pushes fire from this container.
     */
    fileSystem?: MobilePreviewVfs;
    /**
     * Latest preflight summary from the overlay-build pipeline.
     * Pass from whichever MobX store holds it (typically the
     * overlay-pipeline state after `preflightAbiV1Imports`). Null
     * when the last build had no unsupported / unknown specifiers.
     */
    preflightSummary?: PreflightSummary | null;
    /** Initial tab. Defaults to 'console'. */
    defaultTab?: MobileDevPanelTabKey;
    className?: string;
    panelClassName?: string;
}

export function MobilePreviewDevPanelContainer({
    serverBaseUrl,
    fileSystem,
    preflightSummary = null,
    defaultTab = 'console',
    className,
    panelClassName,
}: MobilePreviewDevPanelContainerProps) {
    const { relayWsClient, status } = useMobilePreviewStatus({
        serverBaseUrl,
        fileSystem,
    });
    const snap = useRelaySnapshot(relayWsClient);

    // The preview session id is only stable when status === 'ready'.
    // MobileDevPanel filters its tabs by sessionId; passing undefined
    // shows all sessions (safer than a stale id pointing at a past
    // session).
    const sessionId = relayWsClient ? extractSessionId(status) : undefined;

    // Split the snapshot's combined messages into (a) WsMessage[] for
    // the console/network/error/select/tap tabs and (b) a mutable
    // OverlayAckMessage[] for the ack tab. snapshot() returns a
    // readonly buffer; spread to a mutable array for the prop.
    const messages: WsMessage[] = [];
    for (const m of snap?.messages ?? []) {
        if (m.type !== 'onlook:overlayAck') messages.push(m as WsMessage);
    }
    const acks: OverlayAckMessage[] = [...(snap?.acks ?? [])];

    return (
        <MobileDevPanel
            messages={messages}
            acks={acks}
            preflightSummary={preflightSummary}
            sessionId={sessionId}
            defaultTab={defaultTab}
            className={className}
            panelClassName={panelClassName}
        />
    );
}

/**
 * Pull the sessionId out of a ready-state status. Defensive —
 * `status.manifestUrl` exists on ready but parsing it here would
 * duplicate the work `useRelayWsClient` already did. If the client
 * is live we know the sessionId is valid; we just don't have it
 * exposed on its own. Return undefined so MobileDevPanel renders
 * unfiltered — acceptable UX degradation.
 */
function extractSessionId(
    _status: ReturnType<typeof useMobilePreviewStatus>['status'],
): string | undefined {
    // TODO(phase-9): expose sessionId as a first-class field on
    // `useMobilePreviewStatus`'s return (or via `useRelayWsClient`)
    // so the dev panel can filter correctly. For now render all
    // sessions; the common case is one session per editor anyway.
    return undefined;
}


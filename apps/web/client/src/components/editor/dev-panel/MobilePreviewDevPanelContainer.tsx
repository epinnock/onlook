'use client';

/**
 * MobilePreviewDevPanelContainer — drop-in composite component that
 * renders `MobileDevPanel` with live data flowing from the Phase 9
 * wire-in chain:
 *
 *   useMobilePreviewStatus      (commit a3dbd5d4)
 *     ↓ relayWsClient, sessionId
 *   useRelaySnapshot            (commit 47448a33)
 *     ↓ {messages, acks}
 *   MobileDevPanel              (this component)
 *
 * Wired into the editor layout (commit 38fd856c) as a synthetic
 * "Mobile Preview" tab inside `terminal-area.tsx`, gated to
 * ExpoBrowser branches. Keep the composition encapsulated here so
 * downstream callers don't have to re-derive the hook chain — they
 * only pick a tab/pane and drop this component in:
 *
 *   <MobilePreviewDevPanelContainer
 *     serverBaseUrl={env.NEXT_PUBLIC_MOBILE_PREVIEW_URL}
 *     fileSystem={branch.fileSystem}
 *     defaultTab="console"
 *   />
 */
import type { OverlayAckMessage, WsMessage } from '@onlook/mobile-client-protocol';

import type { MobileDevPanelTabKey } from './MobileDevPanel';
import type { PreflightSummary } from '@/services/expo-relay/preflight-formatter';
import type { MobilePreviewVfs } from '@/services/mobile-preview';
import { useMobilePreviewStatus } from '@/hooks/use-mobile-preview-status';
import { useRelaySnapshot } from '@/hooks/use-relay-snapshot';
import { MobileDevPanel } from './MobileDevPanel';

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
    const { relayWsClient, sessionId } = useMobilePreviewStatus({
        serverBaseUrl,
        fileSystem,
    });
    const snap = useRelaySnapshot(relayWsClient);

    // Split the snapshot's combined messages into (a) WsMessage[] for
    // the console/network/error/select/tap tabs and (b) a mutable
    // OverlayAckMessage[] for the ack tab. snapshot() returns a
    // readonly buffer; spread to a mutable array for the prop.
    const messages: WsMessage[] = [];
    for (const m of snap?.messages ?? []) {
        if (m.type !== 'onlook:overlayAck') messages.push(m);
    }
    const acks: OverlayAckMessage[] = [...(snap?.acks ?? [])];

    return (
        <MobileDevPanel
            messages={messages}
            acks={acks}
            preflightSummary={preflightSummary}
            sessionId={sessionId ?? undefined}
            defaultTab={defaultTab}
            className={className}
            panelClassName={panelClassName}
        />
    );
}

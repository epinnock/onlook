'use client';

/**
 * MobileDevPanel — composite parent container for the mobile-client
 * dev-panel tabs. Closes the "parent-layout wiring" gap left by the
 * individual tab components:
 *
 *   - MobileConsoleTab         (MC5.16)
 *   - MobileNetworkTab         (MC5.17)
 *   - MobileOverlayAckTab      (MCG.10)
 *   - OverlayPreflightPanel    (#81)
 *
 * Uses `@onlook/ui/tabs` (Radix) — already proven compatible with the
 * editor's React 19 runtime via `terminal-area.tsx`. Each tab panel
 * renders as a full-height scroll pane so the auto-pin behaviour in
 * the console/network/ack tabs works without additional layout hacks.
 *
 * Callers own the data sources — typically:
 *   - `messages` / `acks` come from a `RelayWsClient.snapshot()` tap
 *     on a MobX store or React context.
 *   - `preflightSummary` comes from the overlay-pipeline step right
 *     before `pushOverlay` — rebuilt whenever the user edits a file.
 *   - `sessionId` scopes the console/network/ack tabs to the paired
 *     preview session (omit to show all sessions).
 *
 * A single `defaultTab` prop picks the initial tab; once mounted the
 * user-selected tab is owned by Tabs' internal state (controlled-mode
 * is intentionally not exposed — parent reference uses Tabs' default
 * uncontrolled semantics).
 */

import type {
    OverlayAckMessage,
    WsMessage,
} from '@onlook/mobile-client-protocol';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@onlook/ui/tabs';
import { cn } from '@onlook/ui/utils';

import type { PreflightSummary } from '@/services/expo-relay/preflight-formatter';

import { MobileConsoleTab } from './MobileConsoleTab';
import { MobileNetworkTab } from './MobileNetworkTab';
import { MobileOverlayAckTab, filterOverlayAcks } from './MobileOverlayAckTab';
import { OverlayPreflightPanel } from './OverlayPreflightPanel';

export type MobileDevPanelTabKey =
    | 'console'
    | 'network'
    | 'acks'
    | 'preflight';

export interface MobileDevPanelProps {
    /** Full WsMessage stream from the RelayWsClient. Filtered per-tab. */
    messages: WsMessage[];
    /**
     * Optional pre-filtered ack buffer (e.g. `client.snapshot().acks`).
     * Omit to derive from `messages` — the tab will filter with
     * `filterOverlayAcks` internally.
     */
    acks?: OverlayAckMessage[];
    /** Preflight summary from the last overlay build, or null if clean. */
    preflightSummary: PreflightSummary | null;
    /** Optional session filter applied to console, network, and acks tabs. */
    sessionId?: string;
    /** Initial tab. Defaults to 'console'. */
    defaultTab?: MobileDevPanelTabKey;
    className?: string;
    /** Optional class applied to each TabsContent container. */
    panelClassName?: string;
}

export function deriveAckCount(
    messages: WsMessage[],
    acks: OverlayAckMessage[] | undefined,
    sessionId?: string,
): number {
    if (acks) {
        if (!sessionId) return acks.length;
        return acks.filter((a) => a.sessionId === sessionId).length;
    }
    return filterOverlayAcks(messages, sessionId).length;
}

export function derivePreflightIssueCount(summary: PreflightSummary | null): number {
    if (summary === null) return 0;
    return summary.byKind['unsupported-native'].length + summary.byKind['unknown-specifier'].length;
}

export function MobileDevPanel({
    messages,
    acks,
    preflightSummary,
    sessionId,
    defaultTab = 'console',
    className,
    panelClassName,
}: MobileDevPanelProps) {
    const ackCount = deriveAckCount(messages, acks, sessionId);
    const preflightCount = derivePreflightIssueCount(preflightSummary);

    const ackItems = acks ?? messages;

    return (
        <Tabs
            defaultValue={defaultTab}
            data-testid="mobile-dev-panel"
            className={cn('flex h-full flex-col bg-neutral-950', className)}
        >
            <TabsList
                data-testid="mobile-dev-panel-tabs"
                className="shrink-0 bg-neutral-900"
            >
                <TabsTrigger value="console" data-testid="mobile-dev-panel-tab-console">
                    Console
                </TabsTrigger>
                <TabsTrigger value="network" data-testid="mobile-dev-panel-tab-network">
                    Network
                </TabsTrigger>
                <TabsTrigger value="acks" data-testid="mobile-dev-panel-tab-acks">
                    Overlay Acks
                    {ackCount > 0 ? (
                        <span
                            data-testid="mobile-dev-panel-acks-badge"
                            className="ml-1.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-emerald-500/25 px-1 text-[10px] tabular-nums text-emerald-300"
                        >
                            {ackCount}
                        </span>
                    ) : null}
                </TabsTrigger>
                <TabsTrigger value="preflight" data-testid="mobile-dev-panel-tab-preflight">
                    Preflight
                    {preflightCount > 0 ? (
                        <span
                            data-testid="mobile-dev-panel-preflight-badge"
                            className="ml-1.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500/25 px-1 text-[10px] tabular-nums text-red-300"
                        >
                            {preflightCount}
                        </span>
                    ) : null}
                </TabsTrigger>
            </TabsList>
            <TabsContent
                value="console"
                data-testid="mobile-dev-panel-panel-console"
                className={cn('min-h-0 flex-1', panelClassName)}
            >
                <MobileConsoleTab messages={messages} sessionId={sessionId} />
            </TabsContent>
            <TabsContent
                value="network"
                data-testid="mobile-dev-panel-panel-network"
                className={cn('min-h-0 flex-1', panelClassName)}
            >
                <MobileNetworkTab messages={messages} sessionId={sessionId} />
            </TabsContent>
            <TabsContent
                value="acks"
                data-testid="mobile-dev-panel-panel-acks"
                className={cn('min-h-0 flex-1', panelClassName)}
            >
                <MobileOverlayAckTab acks={ackItems} sessionId={sessionId} />
            </TabsContent>
            <TabsContent
                value="preflight"
                data-testid="mobile-dev-panel-panel-preflight"
                className={cn('min-h-0 flex-1', panelClassName)}
            >
                <OverlayPreflightPanel summary={preflightSummary} />
            </TabsContent>
        </Tabs>
    );
}

/**
 * Editor-side dev-panel barrel.
 *
 * Feature entry points for the mobile client's in-editor debug surface.
 * Each tab owns its own file and is re-exported here so consumers can
 * import from `@/components/editor/dev-panel` without caring about the
 * internal layout.
 *
 * Populated so far:
 *   - MobileConsoleTab (MC5.16) — console stream rendering
 *   - MobileNetworkTab (MC5.17) — network stream rendering
 *   - MobileOverlayAckTab (MCG.10) — phone→editor overlay ack stream
 *   - OverlayPreflightPanel (#81) — overlay preflight issues before push
 */

export {
    MobileConsoleRow,
    MobileConsoleTab,
    filterConsoleMessages,
    type MobileConsoleRowProps,
    type MobileConsoleTabProps,
} from './MobileConsoleTab';

export {
    MobileNetworkRow,
    MobileNetworkTab,
    computeNextSelected,
    filterNetworkMessages,
    statusColorClass,
    type MobileNetworkRowProps,
    type MobileNetworkTabProps,
} from './MobileNetworkTab';

export {
    MobileOverlayAckRow,
    MobileOverlayAckTab,
    filterOverlayAcks,
    type MobileOverlayAckRowProps,
    type MobileOverlayAckTabProps,
} from './MobileOverlayAckTab';

export {
    OverlayPreflightIssueRow,
    OverlayPreflightPanel,
    type OverlayPreflightIssueRowProps,
    type OverlayPreflightPanelProps,
} from './OverlayPreflightPanel';

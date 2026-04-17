/**
 * Dev menu action: view recent logs — MC5.15
 *
 * Opens the RecentLogsModal (MC5.15 component) which renders the buffered
 * console output captured by the console relay (MC5.1).
 *
 * Because modal visibility is owned by the app-level component (so state
 * survives beyond the dev menu lifecycle), the factory accepts a
 * `setVisible` callback rather than managing state internally.
 */

import type { DevMenuAction } from '../components/DevMenu';

/**
 * Create a `DevMenuAction` that opens the recent-logs modal by invoking the
 * supplied `setVisible(true)` callback. Modal visibility state is owned by
 * the caller (typically the app root) so the modal persists after the dev
 * menu closes.
 */
export function createViewLogsAction(
    setVisible: (v: boolean) => void,
): DevMenuAction {
    return {
        label: 'View Recent Logs',
        onPress: () => setVisible(true),
    };
}

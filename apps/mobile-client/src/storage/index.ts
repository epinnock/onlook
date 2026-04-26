/**
 * Storage barrel — re-exports all storage utilities.
 *
 * Task: MC3.8
 */

export {
    addRecentSession,
    clearRecentSessions,
    getRecentSessions,
    RecentSessionSchema,
} from './recentSessions';
export type { RecentSession } from './recentSessions';

export {
    DEV_MENU_ENABLED_KEY,
    isDevMenuEnabled,
    loadDevMenuEnabled,
    onDevMenuEnabledChange,
    setDevMenuEnabled,
} from './devMenuEnabled';

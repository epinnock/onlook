/**
 * NavigationContext — shared navigation state for the custom stack navigator.
 *
 * Provides `navigate(screen, params?)`, `goBack()`, and `resetTo(screen, params?)`
 * to any descendant component via `useNavigation()`.
 */

import { createContext, useContext } from 'react';

/** Union of all screen names in the app. */
export type Screen =
    | 'launcher'
    | 'scan'
    | 'settings'
    | 'error'
    | 'versionMismatch'
    | 'crash'
    | 'gallery';

/**
 * Optional parameters passed alongside a screen transition.
 * Only relevant for screens that accept dynamic data (error, versionMismatch).
 */
export interface NavigationParams {
    errorTitle?: string;
    errorMessage?: string;
    errorDetails?: string;
    onRetry?: () => void;
    clientVersion?: string;
    serverVersion?: string;
}

export interface NavigationContextValue {
    /** Push a screen onto the stack. */
    navigate: (screen: Screen, params?: NavigationParams) => void;
    /** Pop the current screen. No-op if already at the root. */
    goBack: () => void;
    /** Replace the entire stack with a single screen. */
    resetTo: (screen: Screen, params?: NavigationParams) => void;
    /** The currently active screen name. */
    currentScreen: Screen;
}

export const NavigationContext = createContext<NavigationContextValue>({
    navigate: () => {},
    goBack: () => {},
    resetTo: () => {},
    currentScreen: 'launcher',
});

/**
 * Hook to access navigation actions from any component inside AppRouter.
 *
 * @example
 * ```tsx
 * const { navigate, goBack } = useNavigation();
 * ```
 */
export function useNavigation(): NavigationContextValue {
    return useContext(NavigationContext);
}

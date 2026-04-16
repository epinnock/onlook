/**
 * Deep link handler for the Onlook mobile client.
 *
 * Registers a listener for `onlook://` deep links using React Native's
 * `Linking` API, parses incoming URLs via {@link parseOnlookDeepLink}, and
 * forwards valid results to a caller-supplied callback.
 *
 * Also exports a React hook ({@link useDeepLinkHandler}) that registers in a
 * `useEffect` and cleans up on unmount.
 *
 * The callback is a placeholder seam — MC3.20 will wire it into the app router.
 *
 * Task: MC3.4
 */

import { useEffect } from 'react';
import { Linking } from 'react-native';
import { parseOnlookDeepLink } from './parse';
import type { ParsedDeepLink } from './parse';

/**
 * Register a handler for `onlook://` deep links.
 *
 * - Immediately checks {@link Linking.getInitialURL} for a cold-start link.
 * - Subscribes to {@link Linking} `url` events for warm-start links.
 * - Parses every URL through {@link parseOnlookDeepLink}; only non-null
 *   results are forwarded to `onLink`.
 *
 * @returns An unsubscribe function that removes the `url` event listener.
 */
export function registerDeepLinkHandler(
    onLink: (parsed: ParsedDeepLink) => void,
): () => void {
    // Handle cold-start: the app was opened via a deep link while closed.
    void Linking.getInitialURL().then((url) => {
        if (url) {
            const parsed = parseOnlookDeepLink(url);
            if (parsed) {
                onLink(parsed);
            }
        }
    });

    // Handle warm-start: the app is already running and receives a deep link.
    const subscription = Linking.addEventListener('url', ({ url }) => {
        const parsed = parseOnlookDeepLink(url);
        if (parsed) {
            onLink(parsed);
        }
    });

    return () => {
        subscription.remove();
    };
}

/**
 * React hook that registers a deep link handler on mount and cleans up on
 * unmount.
 *
 * The `onLink` callback should be stable (e.g. wrapped in `useCallback`) to
 * avoid unnecessary re-subscriptions.
 *
 * @example
 * ```tsx
 * useDeepLinkHandler((link) => {
 *     navigation.navigate('Launch', { sessionId: link.sessionId });
 * });
 * ```
 */
export function useDeepLinkHandler(
    onLink: (parsed: ParsedDeepLink) => void,
): void {
    useEffect(() => {
        const unsubscribe = registerDeepLinkHandler(onLink);
        return unsubscribe;
    }, [onLink]);
}

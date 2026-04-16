/**
 * VersionMismatchScreen — MC3.15 of plans/onlook-mobile-client-task-queue.md.
 *
 * Displayed when the mobile client's compiled runtime version does not match
 * the version reported by the relay manifest. Wraps the generic ErrorScreen
 * component (MC3.17) with a pre-configured title, explanatory message, and
 * passthrough action callbacks.
 */

import React from 'react';
import ErrorScreen from './ErrorScreen';

interface VersionMismatchScreenProps {
    /** The app's compiled runtime version (e.g. "0.3.0"). */
    clientVersion: string;
    /** The version the relay manifest reported (e.g. "0.4.0"). */
    serverVersion: string;
    /** If provided, renders a "Retry" button that re-fetches the manifest. */
    onRetry?: () => void;
    /** If provided, renders a "Go back" button to return to the launcher. */
    onGoBack?: () => void;
}

export default function VersionMismatchScreen({
    clientVersion,
    serverVersion,
    onRetry,
    onGoBack,
}: VersionMismatchScreenProps) {
    const message =
        `This app (v${clientVersion}) is not compatible with the relay server ` +
        `(v${serverVersion}). Please update the app or ask the project owner ` +
        `to update their Onlook editor.`;

    return (
        <ErrorScreen
            title="Version Mismatch"
            message={message}
            onRetry={onRetry}
            onGoBack={onGoBack}
        />
    );
}

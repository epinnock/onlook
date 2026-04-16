/**
 * AppRouter — MC3.20 of plans/onlook-mobile-client-task-queue.md.
 *
 * Minimal custom stack navigator for the Onlook Mobile Client. Uses React
 * state instead of @react-navigation to avoid a heavy dependency for a
 * 5-screen app.
 *
 * Screens:
 *  - launcher       (initial / home)
 *  - scan           (QR scanner)
 *  - settings       (relay host, clear cache, dev menu)
 *  - error          (generic error display)
 *  - versionMismatch (relay version incompatibility)
 *
 * Navigation helpers (`navigate`, `goBack`) are exposed via
 * NavigationContext so any descendant can trigger screen transitions.
 */

import React, { useCallback, useMemo, useState } from 'react';
import { View, StyleSheet } from 'react-native';
import {
    ErrorScreen,
    LauncherScreen,
    ScanScreen,
    SettingsScreen,
    VersionMismatchScreen,
} from '../screens';
import {
    NavigationContext,
    type Screen,
    type NavigationParams,
} from './NavigationContext';

export default function AppRouter() {
    const [stack, setStack] = useState<Array<{ screen: Screen; params?: NavigationParams }>>([
        { screen: 'launcher' },
    ]);

    const current = stack[stack.length - 1]!;

    const navigate = useCallback((screen: Screen, params?: NavigationParams) => {
        setStack((prev) => [...prev, { screen, params }]);
    }, []);

    const goBack = useCallback(() => {
        setStack((prev) => (prev.length > 1 ? prev.slice(0, -1) : prev));
    }, []);

    const resetTo = useCallback((screen: Screen, params?: NavigationParams) => {
        setStack([{ screen, params }]);
    }, []);

    const contextValue = useMemo(
        () => ({ navigate, goBack, resetTo, currentScreen: current.screen }),
        [navigate, goBack, resetTo, current.screen],
    );

    return (
        <NavigationContext.Provider value={contextValue}>
            <View style={styles.root}>
                {renderScreen(current.screen, current.params, { navigate, goBack, resetTo })}
            </View>
        </NavigationContext.Provider>
    );
}

interface NavActions {
    navigate: (screen: Screen, params?: NavigationParams) => void;
    goBack: () => void;
    resetTo: (screen: Screen, params?: NavigationParams) => void;
}

function renderScreen(
    screen: Screen,
    params: NavigationParams | undefined,
    actions: NavActions,
): React.ReactElement {
    switch (screen) {
        case 'launcher':
            return (
                <LauncherScreen
                    onScanPress={() => actions.navigate('scan')}
                    onSettingsPress={() => actions.navigate('settings')}
                />
            );

        case 'scan':
            return (
                <ScanScreen
                    onScan={(data: string) => {
                        // After scanning, return to launcher. The scan-to-mount
                        // flow (MC3.21) will handle the actual bundle load.
                        void data;
                        actions.goBack();
                    }}
                    onCancel={() => actions.goBack()}
                />
            );

        case 'settings':
            return <SettingsScreen onGoBack={() => actions.goBack()} />;

        case 'error':
            return (
                <ErrorScreen
                    title={params?.errorTitle ?? 'Something went wrong'}
                    message={params?.errorMessage ?? 'An unexpected error occurred.'}
                    details={params?.errorDetails}
                    onRetry={params?.onRetry}
                    onGoBack={() => actions.goBack()}
                />
            );

        case 'versionMismatch':
            return (
                <VersionMismatchScreen
                    clientVersion={params?.clientVersion ?? '0.0.0'}
                    serverVersion={params?.serverVersion ?? '0.0.0'}
                    onRetry={params?.onRetry}
                    onGoBack={() => actions.goBack()}
                />
            );
    }
}

const styles = StyleSheet.create({
    root: {
        flex: 1,
        backgroundColor: '#0A0A0A',
    },
});

/**
 * LauncherScreen — MC3.5 of plans/onlook-mobile-client-task-queue.md.
 *
 * The main landing screen of the Onlook Mobile Client. Users see this on
 * cold-start and navigate from here to the QR scanner (MC3.6), recent
 * sessions list (MC3.9), or settings (MC3.10).
 *
 * Layout:
 *  - App branding header ("Onlook")
 *  - Primary CTA: "Scan QR" button
 *  - "Recent sessions" section (placeholder; list content lands in MC3.9)
 *  - "Settings" touchable at the bottom
 */

import React, { useEffect } from 'react';
import { Pressable, SafeAreaView, StyleSheet, Text, View } from 'react-native';

interface LauncherScreenProps {
    /** Called when the user taps "Scan QR". */
    onScanPress?: () => void;
    /** Called when the user taps "Settings". */
    onSettingsPress?: () => void;
}

// `OnlookRuntime.log` (when the JSI binding is wired) forwards into os_log with
// the `[onlook-runtime]` prefix; until then, plain `console.log` is funneled by
// Hermes's `nativeLoggingHook` to the same device syslog stream. Either path is
// grepable from `validate-iphone-launch.sh`.
declare const globalThis: Record<string, unknown> & {
    OnlookRuntime?: { log?: (msg: string) => void };
};

export default function LauncherScreen({ onScanPress, onSettingsPress }: LauncherScreenProps) {
    useEffect(() => {
        // Mount marker consumed by apps/mobile-client/scripts/validate-iphone-launch.sh.
        const msg = '[onlook-runtime] LauncherScreen mounted';
        if (globalThis.OnlookRuntime?.log) {
            globalThis.OnlookRuntime.log('LauncherScreen mounted');
        } else {
            console.log(msg);
        }
    }, []);

    return (
        <SafeAreaView style={styles.root}>
            {/* ── Branding header ── */}
            <View style={styles.header}>
                <Text style={styles.title}>Onlook</Text>
            </View>

            {/* ── Primary CTA ── */}
            <View style={styles.ctaContainer}>
                <Pressable
                    style={({ pressed }) => [
                        styles.scanButton,
                        pressed && styles.scanButtonPressed,
                    ]}
                    onPress={onScanPress}
                    accessibilityRole="button"
                    accessibilityLabel="Scan QR"
                >
                    <Text style={styles.scanButtonText}>Scan QR</Text>
                </Pressable>
            </View>

            {/* ── Recent sessions (placeholder) ── */}
            <View style={styles.recentSection}>
                <Text style={styles.sectionHeader}>Recent sessions</Text>
                {/* MC3.9 populates the list here */}
                <View style={styles.placeholder} />
            </View>

            {/* ── Settings touchable ── */}
            <View style={styles.footer}>
                <Pressable
                    style={({ pressed }) => [
                        styles.settingsButton,
                        pressed && styles.settingsButtonPressed,
                    ]}
                    onPress={onSettingsPress}
                    accessibilityRole="button"
                    accessibilityLabel="Settings"
                >
                    <Text style={styles.settingsText}>Settings</Text>
                </Pressable>
            </View>
        </SafeAreaView>
    );
}

const styles = StyleSheet.create({
    root: {
        flex: 1,
        backgroundColor: '#0A0A0A',
    },
    header: {
        paddingTop: 24,
        paddingBottom: 16,
        alignItems: 'center',
    },
    title: {
        fontSize: 28,
        fontWeight: '700',
        color: '#FFFFFF',
        letterSpacing: 0.5,
    },
    ctaContainer: {
        paddingHorizontal: 24,
        paddingVertical: 16,
    },
    scanButton: {
        backgroundColor: '#FFFFFF',
        borderRadius: 12,
        paddingVertical: 16,
        alignItems: 'center',
    },
    scanButtonPressed: {
        opacity: 0.8,
    },
    scanButtonText: {
        fontSize: 17,
        fontWeight: '600',
        color: '#0A0A0A',
    },
    recentSection: {
        flex: 1,
        paddingHorizontal: 24,
        paddingTop: 24,
    },
    sectionHeader: {
        fontSize: 15,
        fontWeight: '600',
        color: '#A0A0A0',
        textTransform: 'uppercase',
        letterSpacing: 1,
        marginBottom: 12,
    },
    placeholder: {
        flex: 1,
    },
    footer: {
        paddingHorizontal: 24,
        paddingBottom: 24,
    },
    settingsButton: {
        paddingVertical: 14,
        alignItems: 'center',
        borderRadius: 10,
        borderWidth: 1,
        borderColor: '#333333',
    },
    settingsButtonPressed: {
        backgroundColor: '#1A1A1A',
    },
    settingsText: {
        fontSize: 16,
        fontWeight: '500',
        color: '#CCCCCC',
    },
});

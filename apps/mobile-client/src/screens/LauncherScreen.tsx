/**
 * LauncherScreen — MC3.5 of plans/onlook-mobile-client-task-queue.md.
 *
 * The main landing screen of the Onlook Mobile Client. Users see this on
 * cold-start and navigate from here to the QR scanner (MC3.6), recent
 * sessions list (MC3.9), or settings (MC3.10). A manual URL entry is also
 * provided as a fallback when camera scanning isn't usable (simulator,
 * headless testing, or when the phone can't focus on the QR).
 */

import React, { useEffect, useState } from 'react';
import {
    KeyboardAvoidingView,
    Platform,
    Pressable,
    SafeAreaView,
    StyleSheet,
    Text,
    TextInput,
    View,
} from 'react-native';
import RecentSessionsList from './RecentSessionsList';
import type { RecentSession } from '../storage/recentSessions';

interface LauncherScreenProps {
    onScanPress?: () => void;
    onSettingsPress?: () => void;
    /** Called when the user submits a manually-typed URL. */
    onUrlSubmit?: (url: string) => void;
    /**
     * Called when the user taps a row in the recent sessions list. The
     * caller is expected to convert the session into a deep-link URL and
     * route it through the URL pipeline (see `buildUrlPipelineRunner` in
     * AppRouter).
     */
    onRecentSessionSelect?: (session: RecentSession) => void;
}

declare const globalThis: Record<string, unknown> & {
    OnlookRuntime?: { log?: (msg: string) => void };
};

export default function LauncherScreen({
    onScanPress,
    onSettingsPress,
    onUrlSubmit,
    onRecentSessionSelect,
}: LauncherScreenProps) {
    const [url, setUrl] = useState('');

    useEffect(() => {
        const msg = '[onlook-runtime] LauncherScreen mounted';
        if (globalThis.OnlookRuntime?.log) {
            globalThis.OnlookRuntime.log('LauncherScreen mounted');
        } else {
            console.log(msg);
        }
    }, []);

    const submit = () => {
        const trimmed = url.trim();
        if (!trimmed) return;
        onUrlSubmit?.(trimmed);
    };

    return (
        <SafeAreaView style={styles.root}>
            <KeyboardAvoidingView
                behavior={Platform.OS === 'ios' ? 'padding' : undefined}
                style={styles.flex}
            >
                <View style={styles.header}>
                    <Text style={styles.title}>Onlook</Text>
                </View>

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

                <View style={styles.urlSection}>
                    <Text style={styles.urlLabel}>Or paste URL</Text>
                    <TextInput
                        value={url}
                        onChangeText={setUrl}
                        placeholder="exp://192.168.x.y:8787/manifest/…"
                        placeholderTextColor="#555"
                        autoCapitalize="none"
                        autoCorrect={false}
                        keyboardType="url"
                        returnKeyType="go"
                        onSubmitEditing={submit}
                        style={styles.urlInput}
                        accessibilityLabel="Manifest URL"
                    />
                    <Pressable
                        onPress={submit}
                        disabled={!url.trim()}
                        style={({ pressed }) => [
                            styles.openButton,
                            (!url.trim() || pressed) && styles.openButtonMuted,
                        ]}
                        accessibilityRole="button"
                        accessibilityLabel="Open URL"
                    >
                        <Text style={styles.openButtonText}>Open</Text>
                    </Pressable>
                </View>

                <View style={styles.recentSection}>
                    <Text style={styles.sectionHeader}>Recent sessions</Text>
                    {onRecentSessionSelect ? (
                        <RecentSessionsList onSelect={onRecentSessionSelect} />
                    ) : (
                        <View style={styles.placeholder} />
                    )}
                </View>

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
            </KeyboardAvoidingView>
        </SafeAreaView>
    );
}

const styles = StyleSheet.create({
    root: { flex: 1, backgroundColor: '#0A0A0A' },
    flex: { flex: 1 },
    header: { paddingTop: 24, paddingBottom: 16, alignItems: 'center' },
    title: { fontSize: 28, fontWeight: '700', color: '#FFFFFF', letterSpacing: 0.5 },
    ctaContainer: { paddingHorizontal: 24, paddingVertical: 16 },
    scanButton: {
        backgroundColor: '#FFFFFF',
        borderRadius: 12,
        paddingVertical: 16,
        alignItems: 'center',
    },
    scanButtonPressed: { opacity: 0.8 },
    scanButtonText: { fontSize: 17, fontWeight: '600', color: '#0A0A0A' },
    urlSection: {
        paddingHorizontal: 24,
        paddingBottom: 12,
    },
    urlLabel: {
        fontSize: 13,
        fontWeight: '600',
        color: '#A0A0A0',
        textTransform: 'uppercase',
        letterSpacing: 1,
        marginBottom: 8,
    },
    urlInput: {
        backgroundColor: '#1A1A1A',
        borderRadius: 10,
        borderWidth: 1,
        borderColor: '#333333',
        paddingHorizontal: 14,
        paddingVertical: 12,
        color: '#FFFFFF',
        fontSize: 14,
    },
    openButton: {
        marginTop: 10,
        backgroundColor: '#2D6CDF',
        borderRadius: 10,
        paddingVertical: 12,
        alignItems: 'center',
    },
    openButtonMuted: { opacity: 0.5 },
    openButtonText: { fontSize: 16, fontWeight: '600', color: '#FFFFFF' },
    recentSection: { flex: 1, paddingHorizontal: 24, paddingTop: 12 },
    sectionHeader: {
        fontSize: 15,
        fontWeight: '600',
        color: '#A0A0A0',
        textTransform: 'uppercase',
        letterSpacing: 1,
        marginBottom: 12,
    },
    placeholder: { flex: 1 },
    footer: { paddingHorizontal: 24, paddingBottom: 24 },
    settingsButton: {
        paddingVertical: 14,
        alignItems: 'center',
        borderRadius: 10,
        borderWidth: 1,
        borderColor: '#333333',
    },
    settingsButtonPressed: { backgroundColor: '#1A1A1A' },
    settingsText: { fontSize: 16, fontWeight: '500', color: '#CCCCCC' },
});

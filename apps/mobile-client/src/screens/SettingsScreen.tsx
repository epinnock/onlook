/**
 * SettingsScreen — MC3.10 of plans/onlook-mobile-client-task-queue.md.
 *
 * Provides user-configurable settings for the Onlook Mobile Client:
 *  - Relay host override (TextInput, persisted via expo-secure-store)
 *  - Clear recent sessions (Pressable, calls clearRecentSessions)
 *  - Dev menu toggle (Switch, persisted via expo-secure-store)
 *  - Version display (read-only placeholder)
 *
 * Dark theme consistent with LauncherScreen (#0A0A0A background).
 */

import React, { useCallback, useEffect, useState } from 'react';
import {
    Alert,
    Pressable,
    SafeAreaView,
    StyleSheet,
    Switch,
    Text,
    TextInput,
    View,
} from 'react-native';
import * as SecureStore from 'expo-secure-store';
import { clearRecentSessions } from '../storage';
import { useNavigation } from '../navigation/NavigationContext';
import { APP_VERSION } from '../version';

const RELAY_HOST_KEY = 'onlook_relay_host_override';
const DEV_MENU_KEY = 'onlook_dev_menu_enabled';

interface SettingsScreenProps {
    /** Called when the user taps the back button. */
    onGoBack?: () => void;
}

export default function SettingsScreen({ onGoBack }: SettingsScreenProps) {
    const [relayHost, setRelayHost] = useState('');
    const [devMenuEnabled, setDevMenuEnabled] = useState(false);
    const { navigate } = useNavigation();

    // ── Load persisted values on mount ──
    useEffect(() => {
        let cancelled = false;

        async function load() {
            const [storedHost, storedDevMenu] = await Promise.all([
                SecureStore.getItemAsync(RELAY_HOST_KEY),
                SecureStore.getItemAsync(DEV_MENU_KEY),
            ]);

            if (cancelled) {
                return;
            }

            if (storedHost !== null) {
                setRelayHost(storedHost);
            }

            if (storedDevMenu !== null) {
                setDevMenuEnabled(storedDevMenu === 'true');
            }
        }

        void load();

        return () => {
            cancelled = true;
        };
    }, []);

    // ── Persist relay host on blur / submit ──
    const handleRelayHostSubmit = useCallback(async () => {
        const trimmed = relayHost.trim();
        if (trimmed.length === 0) {
            await SecureStore.deleteItemAsync(RELAY_HOST_KEY);
        } else {
            await SecureStore.setItemAsync(RELAY_HOST_KEY, trimmed);
        }
    }, [relayHost]);

    // ── Persist dev menu toggle ──
    const handleDevMenuToggle = useCallback(async (value: boolean) => {
        setDevMenuEnabled(value);
        await SecureStore.setItemAsync(DEV_MENU_KEY, String(value));
    }, []);

    // ── Clear recent sessions ──
    const handleClearSessions = useCallback(async () => {
        await clearRecentSessions();
        Alert.alert('Done', 'Recent sessions cleared.');
    }, []);

    return (
        <SafeAreaView style={styles.root}>
            {/* ── Header ── */}
            <View style={styles.header}>
                {onGoBack !== undefined && (
                    <Pressable
                        style={styles.backButton}
                        onPress={onGoBack}
                        accessibilityRole="button"
                        accessibilityLabel="Go back"
                    >
                        <Text style={styles.backText}>Back</Text>
                    </Pressable>
                )}
                <Text style={styles.title}>Settings</Text>
            </View>

            {/* ── Relay host override ── */}
            <View style={styles.section}>
                <Text style={styles.label}>Relay host</Text>
                <TextInput
                    style={styles.input}
                    value={relayHost}
                    onChangeText={setRelayHost}
                    onBlur={() => void handleRelayHostSubmit()}
                    onSubmitEditing={() => void handleRelayHostSubmit()}
                    placeholder="localhost:8787"
                    placeholderTextColor="#666666"
                    autoCapitalize="none"
                    autoCorrect={false}
                    keyboardType="url"
                    returnKeyType="done"
                    accessibilityLabel="Relay host"
                />
            </View>

            {/* ── Clear recent sessions ── */}
            <View style={styles.section}>
                <Pressable
                    style={({ pressed }) => [
                        styles.destructiveButton,
                        pressed && styles.destructiveButtonPressed,
                    ]}
                    onPress={() => void handleClearSessions()}
                    accessibilityRole="button"
                    accessibilityLabel="Clear recent sessions"
                >
                    <Text style={styles.destructiveButtonText}>
                        Clear recent sessions
                    </Text>
                </Pressable>
            </View>

            {/* ── Dev menu toggle ── */}
            <View style={styles.section}>
                <View style={styles.row}>
                    <Text style={styles.label}>Dev menu</Text>
                    <Switch
                        value={devMenuEnabled}
                        onValueChange={(v) => void handleDevMenuToggle(v)}
                        trackColor={{ false: '#333333', true: '#4A9EFF' }}
                        thumbColor={devMenuEnabled ? '#FFFFFF' : '#888888'}
                        accessibilityLabel="Dev menu"
                    />
                </View>
            </View>

            {/* ── Version ── */}
            <View style={styles.section}>
                <View style={styles.row}>
                    <Text style={styles.label}>Version</Text>
                    <Text style={styles.valueText}>{APP_VERSION}</Text>
                </View>
            </View>

            {/* ── Dev: Screens gallery ── */}
            <View style={styles.section}>
                <Pressable
                    style={styles.linkRow}
                    onPress={() => navigate('gallery')}
                    accessibilityRole="button"
                >
                    <Text style={styles.linkText}>Screens gallery →</Text>
                    <Text style={styles.linkHint}>Jump to any screen (dev)</Text>
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
    backButton: {
        position: 'absolute',
        left: 16,
        top: 28,
        paddingVertical: 4,
        paddingHorizontal: 8,
        zIndex: 1,
    },
    backText: {
        fontSize: 17,
        fontWeight: '500',
        color: '#FFFFFF',
    },
    title: {
        fontSize: 28,
        fontWeight: '700',
        color: '#FFFFFF',
        letterSpacing: 0.5,
    },
    section: {
        paddingHorizontal: 24,
        paddingVertical: 12,
    },
    label: {
        fontSize: 15,
        fontWeight: '600',
        color: '#A0A0A0',
        textTransform: 'uppercase',
        letterSpacing: 1,
        marginBottom: 8,
    },
    input: {
        backgroundColor: '#1A1A1A',
        borderRadius: 10,
        borderWidth: 1,
        borderColor: '#333333',
        paddingHorizontal: 16,
        paddingVertical: 14,
        fontSize: 16,
        color: '#FFFFFF',
    },
    row: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
    },
    destructiveButton: {
        paddingVertical: 14,
        alignItems: 'center',
        borderRadius: 10,
        borderWidth: 1,
        borderColor: '#333333',
    },
    destructiveButtonPressed: {
        backgroundColor: '#1A1A1A',
    },
    destructiveButtonText: {
        fontSize: 16,
        fontWeight: '500',
        color: '#FF6B6B',
    },
    valueText: {
        fontSize: 15,
        color: '#666666',
    },
    linkRow: {
        paddingVertical: 12,
    },
    linkText: {
        fontSize: 16,
        fontWeight: '500',
        color: '#FFFFFF',
    },
    linkHint: {
        fontSize: 13,
        color: '#666666',
        marginTop: 4,
    },
});

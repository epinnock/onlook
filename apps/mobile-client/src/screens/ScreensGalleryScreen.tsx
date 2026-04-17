/**
 * ScreensGalleryScreen — dev-only screen picker.
 *
 * Lists every named screen in the app with a button that jumps to it via
 * the navigator. Screens that need params get plausible fake values so
 * the gallery works as a zero-setup preview + manual QA surface.
 *
 * Not on the happy-path — surfaced through SettingsScreen's "Dev" section.
 * Keep out of production by guarding the SettingsScreen entry point on a
 * build-time flag if that becomes relevant; for now leaving it reachable
 * is fine since the app is pre-1.0.
 */

import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import { useNavigation, type NavigationParams, type Screen } from '../navigation/NavigationContext';

interface GalleryEntry {
    screen: Screen;
    label: string;
    description: string;
    params?: NavigationParams;
}

const ENTRIES: ReadonlyArray<GalleryEntry> = [
    {
        screen: 'launcher',
        label: 'Launcher',
        description: 'Home screen with Scan QR + Recent Sessions + Settings.',
    },
    {
        screen: 'scan',
        label: 'Scan QR',
        description: 'Camera QR scanner — drives qrToMount on detection.',
    },
    {
        screen: 'settings',
        label: 'Settings',
        description: 'Relay host, clear cache, dev menu toggle, version info.',
    },
    {
        screen: 'error',
        label: 'Error (generic)',
        description: 'Generic error display with retry + go-back.',
        params: {
            errorTitle: 'Something went wrong',
            errorMessage: 'This is a fake error used to preview the ErrorScreen layout.',
            errorDetails: 'No details available.',
        },
    },
    {
        screen: 'versionMismatch',
        label: 'Version Mismatch',
        description: 'Relay protocol version incompatible with this client.',
        params: {
            clientVersion: '0.1.4',
            serverVersion: '0.2.0',
        },
    },
    {
        screen: 'crash',
        label: 'Crash Overlay',
        description: 'JS/React exception surface (MC5.8). Requires error props.',
        params: {
            errorTitle: 'Uncaught TypeError',
            errorMessage: "Cannot read property 'foo' of undefined",
            errorDetails: 'at App.render (App.tsx:42)\nat renderRoot (react-native)',
        },
    },
];

export default function ScreensGalleryScreen() {
    const { navigate, goBack } = useNavigation();

    return (
        <View style={styles.root}>
            <View style={styles.header}>
                <TouchableOpacity onPress={goBack} style={styles.backBtn}>
                    <Text style={styles.backText}>← Back</Text>
                </TouchableOpacity>
                <Text style={styles.title}>Screens</Text>
                <View style={styles.headerSpacer} />
            </View>
            <ScrollView contentContainerStyle={styles.scroll}>
                {ENTRIES.map((entry) => (
                    <TouchableOpacity
                        key={entry.screen}
                        style={styles.row}
                        onPress={() => navigate(entry.screen, entry.params)}
                    >
                        <Text style={styles.rowLabel}>{entry.label}</Text>
                        <Text style={styles.rowDescription}>{entry.description}</Text>
                    </TouchableOpacity>
                ))}
            </ScrollView>
        </View>
    );
}

const styles = StyleSheet.create({
    root: { flex: 1, backgroundColor: '#0A0A0A' },
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 16,
        paddingTop: 12,
        paddingBottom: 16,
    },
    backBtn: { paddingVertical: 8, paddingRight: 8 },
    backText: { color: '#FFFFFF', fontSize: 16 },
    title: { color: '#FFFFFF', fontSize: 20, fontWeight: '700', flex: 1, textAlign: 'center' },
    headerSpacer: { width: 60 },
    scroll: { padding: 16, paddingBottom: 48 },
    row: {
        borderWidth: 1,
        borderColor: '#2A2A2A',
        borderRadius: 12,
        padding: 16,
        marginBottom: 12,
    },
    rowLabel: { color: '#FFFFFF', fontSize: 16, fontWeight: '600', marginBottom: 6 },
    rowDescription: { color: '#888888', fontSize: 13, lineHeight: 18 },
});

/**
 * ProgressScreen — in-flight step indicator for the url-to-mount pipeline.
 *
 * The pipeline's `buildUrlPipelineRunner` used to render every intermediate
 * stage (Preflight B, Parse, Fetching manifest, Fetching bundle, Mounting…)
 * onto `ErrorScreen`, which meant happy-path steps showed a red error icon
 * and a "Go back" button — visually indistinguishable from a failure. See
 * feat/two-tier-bundle evidence screenshots walk-h/walk-h2 for the resulting
 * red-title mid-flow screens that looked like errors but weren't.
 *
 * ProgressScreen renders the same title + log panel with neutral styling:
 *  - Dark background, same as ErrorScreen
 *  - Blue-tinted accent instead of red for icon + title
 *  - Optional ActivityIndicator spinner (default on)
 *  - Optional Cancel button (if onCancel provided); no default button
 *
 * Used exclusively for non-terminal states. Real errors still route to
 * ErrorScreen with red styling + Retry/Go back actions.
 */

import React from 'react';
import {
    ActivityIndicator,
    Platform,
    Pressable,
    SafeAreaView,
    ScrollView,
    StyleSheet,
    Text,
    View,
} from 'react-native';

interface ProgressScreenProps {
    /** Current step label, e.g. "Fetching manifest…" */
    title: string;
    /** Accumulated log output — shown verbatim in a scrollable monospace block. */
    log?: string;
    /** Whether to render the activity spinner. Defaults to true. */
    showSpinner?: boolean;
    /** If provided, renders a Cancel button that calls this handler. */
    onCancel?: () => void;
}

export default function ProgressScreen({
    title,
    log,
    showSpinner = true,
    onCancel,
}: ProgressScreenProps) {
    return (
        <SafeAreaView style={styles.root}>
            <View style={styles.container}>
                <View style={styles.iconContainer}>
                    {showSpinner ? (
                        <ActivityIndicator color={PROGRESS_BLUE} size="small" />
                    ) : (
                        <Text style={styles.iconText}>…</Text>
                    )}
                </View>

                <Text
                    style={styles.title}
                    accessibilityRole="header"
                    accessibilityLabel={`Progress: ${title}`}
                >
                    {title}
                </Text>

                {log !== undefined && log.length > 0 && (
                    <View style={styles.logContainer}>
                        <ScrollView
                            style={styles.logScroll}
                            contentContainerStyle={styles.logContent}
                            accessibilityLabel="Progress log"
                        >
                            <Text style={styles.logText}>{log}</Text>
                        </ScrollView>
                    </View>
                )}

                {onCancel !== undefined && (
                    <View style={styles.actions}>
                        <Pressable
                            style={({ pressed }) => [
                                styles.cancelButton,
                                pressed && styles.buttonPressed,
                            ]}
                            onPress={onCancel}
                            accessibilityRole="button"
                            accessibilityLabel="Cancel"
                        >
                            <Text style={styles.cancelButtonText}>Cancel</Text>
                        </Pressable>
                    </View>
                )}
            </View>
        </SafeAreaView>
    );
}

const PROGRESS_BLUE = '#60A5FA';
const MONOSPACE_FONT = Platform.OS === 'ios' ? 'Menlo' : 'monospace';

const styles = StyleSheet.create({
    root: {
        flex: 1,
        backgroundColor: '#0A0A0A',
    },
    container: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
        paddingHorizontal: 24,
    },
    iconContainer: {
        width: 56,
        height: 56,
        borderRadius: 28,
        backgroundColor: 'rgba(96, 165, 250, 0.15)',
        alignItems: 'center',
        justifyContent: 'center',
        marginBottom: 20,
    },
    iconText: {
        fontSize: 28,
        fontWeight: '700',
        color: PROGRESS_BLUE,
    },
    title: {
        fontSize: 22,
        fontWeight: '600',
        color: PROGRESS_BLUE,
        textAlign: 'center',
        marginBottom: 12,
    },
    logContainer: {
        width: '100%',
        maxHeight: 220,
        borderRadius: 10,
        borderWidth: 1,
        borderColor: '#333333',
        backgroundColor: '#141414',
        marginBottom: 24,
    },
    logScroll: {
        flex: 1,
    },
    logContent: {
        padding: 12,
    },
    logText: {
        fontSize: 12,
        fontFamily: MONOSPACE_FONT,
        color: '#A0A0A0',
        lineHeight: 18,
    },
    actions: {
        width: '100%',
        gap: 12,
        marginTop: 4,
    },
    cancelButton: {
        paddingVertical: 14,
        alignItems: 'center',
        borderRadius: 10,
        borderWidth: 1,
        borderColor: '#333333',
    },
    cancelButtonText: {
        fontSize: 16,
        fontWeight: '500',
        color: '#CCCCCC',
    },
    buttonPressed: {
        opacity: 0.8,
    },
});

/**
 * ErrorScreen — MC3.17 of plans/onlook-mobile-client-task-queue.md.
 *
 * Generic error screen for displaying runtime errors, version mismatches,
 * bundle failures, and other exceptional states. Accepts a title, message,
 * optional debug details, and optional action callbacks (retry / go back).
 *
 * Layout:
 *  - Centered vertically on a dark background
 *  - Red accent error icon placeholder and heading
 *  - Descriptive message below the heading
 *  - Optional scrollable monospace details block (stack trace / debug info)
 *  - Action buttons at the bottom (Retry / Go back) when callbacks provided
 */

import React from 'react';
import {
    Platform,
    Pressable,
    SafeAreaView,
    ScrollView,
    StyleSheet,
    Text,
    View,
} from 'react-native';

interface ErrorScreenProps {
    /** Error heading, e.g. "Something went wrong" or "Version mismatch". */
    title: string;
    /** Detailed error message explaining what happened. */
    message: string;
    /** Optional stack trace or debug info, shown in a scrollable monospace block. */
    details?: string;
    /** If provided, renders a "Retry" button that calls this handler. */
    onRetry?: () => void;
    /** If provided, renders a "Go back" button that calls this handler. */
    onGoBack?: () => void;
}

export default function ErrorScreen({
    title,
    message,
    details,
    onRetry,
    onGoBack,
}: ErrorScreenProps) {
    const hasActions = onRetry !== undefined || onGoBack !== undefined;

    return (
        <SafeAreaView style={styles.root}>
            <View style={styles.container}>
                {/* ── Error icon ── */}
                <View style={styles.iconContainer}>
                    <Text style={styles.iconText}>!</Text>
                </View>

                {/* ── Title ── */}
                <Text style={styles.title}>{title}</Text>

                {/* ── Message ── */}
                <Text style={styles.message}>{message}</Text>

                {/* ── Details (optional) ── */}
                {details !== undefined && details.length > 0 && (
                    <View style={styles.detailsContainer}>
                        <ScrollView
                            style={styles.detailsScroll}
                            contentContainerStyle={styles.detailsContent}
                            accessibilityLabel="Error details"
                        >
                            <Text style={styles.detailsText}>{details}</Text>
                        </ScrollView>
                    </View>
                )}

                {/* ── Action buttons ── */}
                {hasActions && (
                    <View style={styles.actions}>
                        {onRetry !== undefined && (
                            <Pressable
                                style={({ pressed }) => [
                                    styles.retryButton,
                                    pressed && styles.buttonPressed,
                                ]}
                                onPress={onRetry}
                                accessibilityRole="button"
                                accessibilityLabel="Retry"
                            >
                                <Text style={styles.retryButtonText}>Retry</Text>
                            </Pressable>
                        )}
                        {onGoBack !== undefined && (
                            <Pressable
                                style={({ pressed }) => [
                                    styles.goBackButton,
                                    pressed && styles.buttonPressed,
                                ]}
                                onPress={onGoBack}
                                accessibilityRole="button"
                                accessibilityLabel="Go back"
                            >
                                <Text style={styles.goBackButtonText}>Go back</Text>
                            </Pressable>
                        )}
                    </View>
                )}
            </View>
        </SafeAreaView>
    );
}

const ERROR_RED = '#EF4444';
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
        backgroundColor: 'rgba(239, 68, 68, 0.15)',
        alignItems: 'center',
        justifyContent: 'center',
        marginBottom: 20,
    },
    iconText: {
        fontSize: 28,
        fontWeight: '700',
        color: ERROR_RED,
    },
    title: {
        fontSize: 22,
        fontWeight: '700',
        color: ERROR_RED,
        textAlign: 'center',
        marginBottom: 12,
    },
    message: {
        fontSize: 16,
        fontWeight: '400',
        color: '#CCCCCC',
        textAlign: 'center',
        lineHeight: 22,
        marginBottom: 20,
    },
    detailsContainer: {
        width: '100%',
        maxHeight: 200,
        borderRadius: 10,
        borderWidth: 1,
        borderColor: '#333333',
        backgroundColor: '#141414',
        marginBottom: 24,
    },
    detailsScroll: {
        flex: 1,
    },
    detailsContent: {
        padding: 12,
    },
    detailsText: {
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
    retryButton: {
        backgroundColor: ERROR_RED,
        borderRadius: 12,
        paddingVertical: 16,
        alignItems: 'center',
    },
    retryButtonText: {
        fontSize: 17,
        fontWeight: '600',
        color: '#FFFFFF',
    },
    goBackButton: {
        paddingVertical: 14,
        alignItems: 'center',
        borderRadius: 10,
        borderWidth: 1,
        borderColor: '#333333',
    },
    goBackButtonText: {
        fontSize: 16,
        fontWeight: '500',
        color: '#CCCCCC',
    },
    buttonPressed: {
        opacity: 0.8,
    },
});

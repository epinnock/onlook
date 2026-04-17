/**
 * CrashScreen — MC5.8 of plans/onlook-mobile-client-task-queue.md.
 *
 * Friendly crash overlay shown when the user's app throws an uncaught
 * exception at runtime (captured by the React error boundary in MC5.6 or
 * the native JS exception catcher in MC5.7). Presents the error message,
 * a collapsible details section with the JS stack and React component
 * stack, and two CTAs: "View in editor" (forwards the captured exception
 * to the editor via the relay WS) and "Reload" (retries the bundle).
 *
 * Built standalone (not wrapping ErrorScreen) because the required button
 * layout, CTA labels, and collapsible details block diverge materially
 * from ErrorScreen's fixed Retry/Go-back shape. Visual language (dark
 * background, red accent, monospace details) mirrors ErrorScreen so the
 * two screens feel consistent.
 */

import React, { useCallback, useState } from 'react';
import {
    Platform,
    Pressable,
    SafeAreaView,
    ScrollView,
    StyleSheet,
    Text,
    View,
} from 'react-native';

interface CrashScreenProps {
    /** The captured exception that triggered the crash overlay. */
    error: Error;
    /** React component stack string from the error boundary, if available. */
    componentStack?: string | null;
    /**
     * If provided, renders the primary "View in editor" button. Caller wires
     * this up to forward the error + component stack to the editor over the
     * relay WebSocket.
     */
    onViewInEditor?: (error: Error, componentStack: string | null) => void;
    /** If provided, renders a secondary "Reload" button that retries the bundle. */
    onReload?: () => void;
}

export default function CrashScreen({
    error,
    componentStack,
    onViewInEditor,
    onReload,
}: CrashScreenProps) {
    const [detailsExpanded, setDetailsExpanded] = useState(false);

    const stack = error.stack ?? '';
    const normalizedComponentStack = componentStack ?? null;
    const hasDetails =
        stack.length > 0 ||
        (normalizedComponentStack !== null && normalizedComponentStack.length > 0);

    const detailsText = [
        stack.length > 0 ? `Stack:\n${stack}` : null,
        normalizedComponentStack !== null && normalizedComponentStack.length > 0
            ? `Component stack:${normalizedComponentStack}`
            : null,
    ]
        .filter((part): part is string => part !== null)
        .join('\n\n');

    const handleViewInEditor = useCallback(() => {
        onViewInEditor?.(error, normalizedComponentStack);
    }, [error, normalizedComponentStack, onViewInEditor]);

    const handleToggleDetails = useCallback(() => {
        setDetailsExpanded((prev) => !prev);
    }, []);

    return (
        <SafeAreaView style={styles.root}>
            <View style={styles.container}>
                {/* ── Error icon ── */}
                <View style={styles.iconContainer}>
                    <Text style={styles.iconText}>!</Text>
                </View>

                {/* ── Title ── */}
                <Text style={styles.title}>Your app crashed</Text>

                {/* ── Error message ── */}
                <Text style={styles.message}>
                    {error.message.length > 0
                        ? error.message
                        : 'An unknown error occurred.'}
                </Text>

                {/* ── Collapsible details ── */}
                {hasDetails && (
                    <View style={styles.detailsOuter}>
                        <Pressable
                            onPress={handleToggleDetails}
                            accessibilityRole="button"
                            accessibilityLabel={
                                detailsExpanded ? 'Hide details' : 'Show details'
                            }
                            accessibilityState={{ expanded: detailsExpanded }}
                            style={({ pressed }) => [
                                styles.detailsToggle,
                                pressed && styles.buttonPressed,
                            ]}
                        >
                            <Text style={styles.detailsToggleText}>
                                {detailsExpanded ? '▾ Details' : '▸ Details'}
                            </Text>
                        </Pressable>
                        {detailsExpanded && (
                            <View style={styles.detailsContainer}>
                                <ScrollView
                                    style={styles.detailsScroll}
                                    contentContainerStyle={styles.detailsContent}
                                    accessibilityLabel="Error details"
                                >
                                    <Text style={styles.detailsText}>{detailsText}</Text>
                                </ScrollView>
                            </View>
                        )}
                    </View>
                )}

                {/* ── Action buttons ── */}
                <View style={styles.actions}>
                    {onViewInEditor !== undefined && (
                        <Pressable
                            style={({ pressed }) => [
                                styles.primaryButton,
                                pressed && styles.buttonPressed,
                            ]}
                            onPress={handleViewInEditor}
                            accessibilityRole="button"
                            accessibilityLabel="View in editor"
                        >
                            <Text style={styles.primaryButtonText}>View in editor</Text>
                        </Pressable>
                    )}
                    {onReload !== undefined && (
                        <Pressable
                            style={({ pressed }) => [
                                styles.secondaryButton,
                                pressed && styles.buttonPressed,
                            ]}
                            onPress={onReload}
                            accessibilityRole="button"
                            accessibilityLabel="Reload"
                        >
                            <Text style={styles.secondaryButtonText}>Reload</Text>
                        </Pressable>
                    )}
                </View>
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
    detailsOuter: {
        width: '100%',
        marginBottom: 24,
    },
    detailsToggle: {
        paddingVertical: 10,
        paddingHorizontal: 4,
        alignSelf: 'flex-start',
    },
    detailsToggleText: {
        fontSize: 14,
        fontWeight: '500',
        color: '#A0A0A0',
    },
    detailsContainer: {
        width: '100%',
        maxHeight: 200,
        borderRadius: 10,
        borderWidth: 1,
        borderColor: '#333333',
        backgroundColor: '#141414',
        marginTop: 8,
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
    primaryButton: {
        backgroundColor: ERROR_RED,
        borderRadius: 12,
        paddingVertical: 16,
        alignItems: 'center',
    },
    primaryButtonText: {
        fontSize: 17,
        fontWeight: '600',
        color: '#FFFFFF',
    },
    secondaryButton: {
        paddingVertical: 14,
        alignItems: 'center',
        borderRadius: 10,
        borderWidth: 1,
        borderColor: '#333333',
    },
    secondaryButtonText: {
        fontSize: 16,
        fontWeight: '500',
        color: '#CCCCCC',
    },
    buttonPressed: {
        opacity: 0.8,
    },
});

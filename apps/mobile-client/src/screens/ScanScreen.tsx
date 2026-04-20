/**
 * ScanScreen — MC3.6 of plans/onlook-mobile-client-task-queue.md.
 *
 * QR code scanner screen using expo-camera. Requests camera permission on
 * mount and renders a fullscreen camera viewfinder with a dark overlay and
 * clear center square when permission is granted. A 3-second debounce
 * prevents rapid-fire duplicate scans.
 *
 * Props:
 *  - onScan(data: string) — called when a QR code is detected
 *  - onCancel()           — called when the user taps the back button
 */

import React, { useCallback, useRef, useState } from 'react';
import {
    Dimensions,
    Pressable,
    SafeAreaView,
    StyleSheet,
    Text,
    View,
} from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import type { BarcodeScanningResult } from 'expo-camera';

const SCAN_DEBOUNCE_MS = 3_000;
const { width: SCREEN_WIDTH } = Dimensions.get('window');
/** Side length of the clear viewfinder square. */
const VIEWFINDER_SIZE = SCREEN_WIDTH * 0.7;

interface ScanScreenProps {
    /** Called with the decoded barcode data string when a QR code is detected. */
    onScan: (data: string) => void;
    /** Called when the user taps the cancel / back button. */
    onCancel: () => void;
}

export default function ScanScreen({ onScan, onCancel }: ScanScreenProps) {
    const [permission, requestPermission] = useCameraPermissions();
    const [scanned, setScanned] = useState(false);
    const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

    const handleBarcodeScanned = useCallback(
        (result: BarcodeScanningResult) => {
            if (scanned) {
                return;
            }

            setScanned(true);
            onScan(result.data);

            debounceTimer.current = setTimeout(() => {
                setScanned(false);
            }, SCAN_DEBOUNCE_MS);
        },
        [scanned, onScan],
    );

    // ── Permission not yet resolved ──
    if (permission === null) {
        return (
            <SafeAreaView style={styles.root}>
                <View style={styles.centered}>
                    <Text style={styles.statusText}>Initializing camera…</Text>
                </View>
            </SafeAreaView>
        );
    }

    // ── Permission denied ──
    if (!permission.granted) {
        return (
            <SafeAreaView style={styles.root}>
                <View style={styles.topBar}>
                    <Pressable
                        onPress={onCancel}
                        style={({ pressed }) => [
                            styles.cancelButton,
                            pressed && styles.cancelButtonPressed,
                        ]}
                        accessibilityRole="button"
                        accessibilityLabel="Cancel"
                    >
                        <Text style={styles.cancelText}>Cancel</Text>
                    </Pressable>
                </View>
                <View style={styles.centered}>
                    <Text style={styles.permissionTitle}>
                        Camera permission required
                    </Text>
                    <Text style={styles.permissionMessage}>
                        Onlook needs camera access to scan QR codes from the
                        desktop editor.
                    </Text>
                    <Pressable
                        onPress={requestPermission}
                        style={({ pressed }) => [
                            styles.grantButton,
                            pressed && styles.grantButtonPressed,
                        ]}
                        accessibilityRole="button"
                        accessibilityLabel="Grant Permission"
                    >
                        <Text style={styles.grantButtonText}>
                            Grant Permission
                        </Text>
                    </Pressable>
                </View>
            </SafeAreaView>
        );
    }

    // ── Permission granted — render camera ──
    return (
        <View style={styles.cameraRoot}>
            <CameraView
                style={StyleSheet.absoluteFill}
                facing="back"
                barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
                onBarcodeScanned={scanned ? undefined : handleBarcodeScanned}
            />

            {/* Dark overlay with transparent viewfinder hole */}
            <View style={styles.overlay} pointerEvents="none">
                {/* Top bar */}
                <View style={styles.overlayTop} />
                {/* Middle row: left | viewfinder | right */}
                <View style={styles.overlayMiddle}>
                    <View style={styles.overlaySide} />
                    <View style={styles.viewfinder}>
                        {/* Corner accents */}
                        <View style={[styles.corner, styles.cornerTL]} />
                        <View style={[styles.corner, styles.cornerTR]} />
                        <View style={[styles.corner, styles.cornerBL]} />
                        <View style={[styles.corner, styles.cornerBR]} />
                    </View>
                    <View style={styles.overlaySide} />
                </View>
                {/* Bottom bar */}
                <View style={styles.overlayBottom} />
            </View>

            {/* Cancel button floating at top-left */}
            <SafeAreaView style={styles.cameraTopBar}>
                <Pressable
                    onPress={onCancel}
                    style={({ pressed }) => [
                        styles.cancelButton,
                        pressed && styles.cancelButtonPressed,
                    ]}
                    accessibilityRole="button"
                    accessibilityLabel="Cancel"
                >
                    <Text style={styles.cancelText}>Cancel</Text>
                </Pressable>
            </SafeAreaView>

            {/* Hint text below viewfinder */}
            <View style={styles.hintContainer} pointerEvents="none">
                <Text style={styles.hintText}>
                    Point at the QR code in the Onlook editor
                </Text>
            </View>
        </View>
    );
}

const OVERLAY_COLOR = 'rgba(0, 0, 0, 0.65)';
const CORNER_LENGTH = 24;
const CORNER_WIDTH = 3;
const ACCENT_COLOR = '#FFFFFF';

const styles = StyleSheet.create({
    /* ── Shared / Permission states ── */
    root: {
        flex: 1,
        backgroundColor: '#0A0A0A',
    },
    centered: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
        paddingHorizontal: 32,
    },
    statusText: {
        fontSize: 16,
        color: '#A0A0A0',
    },
    permissionTitle: {
        fontSize: 20,
        fontWeight: '700',
        color: '#FFFFFF',
        textAlign: 'center',
        marginBottom: 12,
    },
    permissionMessage: {
        fontSize: 15,
        color: '#A0A0A0',
        textAlign: 'center',
        lineHeight: 22,
        marginBottom: 28,
    },
    grantButton: {
        backgroundColor: '#FFFFFF',
        borderRadius: 12,
        paddingVertical: 16,
        paddingHorizontal: 32,
        alignItems: 'center',
    },
    grantButtonPressed: {
        opacity: 0.8,
    },
    grantButtonText: {
        fontSize: 17,
        fontWeight: '600',
        color: '#0A0A0A',
    },

    /* ── Top bar (shared) ── */
    topBar: {
        flexDirection: 'row',
        paddingHorizontal: 16,
        paddingTop: 8,
    },
    cancelButton: {
        paddingVertical: 8,
        paddingHorizontal: 12,
    },
    cancelButtonPressed: {
        opacity: 0.6,
    },
    cancelText: {
        fontSize: 17,
        fontWeight: '500',
        color: '#FFFFFF',
    },

    /* ── Camera state ── */
    cameraRoot: {
        flex: 1,
        backgroundColor: '#000000',
    },
    cameraTopBar: {
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        zIndex: 10,
        paddingHorizontal: 16,
        paddingTop: 8,
    },

    /* ── Overlay ── */
    overlay: {
        ...StyleSheet.absoluteFillObject,
        zIndex: 5,
    },
    overlayTop: {
        flex: 1,
        backgroundColor: OVERLAY_COLOR,
    },
    overlayMiddle: {
        flexDirection: 'row',
        height: VIEWFINDER_SIZE,
    },
    overlaySide: {
        flex: 1,
        backgroundColor: OVERLAY_COLOR,
    },
    viewfinder: {
        width: VIEWFINDER_SIZE,
        height: VIEWFINDER_SIZE,
        borderRadius: 2,
    },
    overlayBottom: {
        flex: 1,
        backgroundColor: OVERLAY_COLOR,
    },

    /* ── Corner accents ── */
    corner: {
        position: 'absolute',
        width: CORNER_LENGTH,
        height: CORNER_LENGTH,
    },
    cornerTL: {
        top: 0,
        left: 0,
        borderTopWidth: CORNER_WIDTH,
        borderLeftWidth: CORNER_WIDTH,
        borderColor: ACCENT_COLOR,
    },
    cornerTR: {
        top: 0,
        right: 0,
        borderTopWidth: CORNER_WIDTH,
        borderRightWidth: CORNER_WIDTH,
        borderColor: ACCENT_COLOR,
    },
    cornerBL: {
        bottom: 0,
        left: 0,
        borderBottomWidth: CORNER_WIDTH,
        borderLeftWidth: CORNER_WIDTH,
        borderColor: ACCENT_COLOR,
    },
    cornerBR: {
        bottom: 0,
        right: 0,
        borderBottomWidth: CORNER_WIDTH,
        borderRightWidth: CORNER_WIDTH,
        borderColor: ACCENT_COLOR,
    },

    /* ── Hint ── */
    hintContainer: {
        position: 'absolute',
        bottom: 120,
        left: 0,
        right: 0,
        alignItems: 'center',
        zIndex: 10,
    },
    hintText: {
        fontSize: 15,
        fontWeight: '500',
        color: '#FFFFFF',
        textAlign: 'center',
        opacity: 0.85,
    },
});

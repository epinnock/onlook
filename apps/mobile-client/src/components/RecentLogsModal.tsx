/**
 * RecentLogsModal — MC5.15 of plans/onlook-mobile-client-task-queue.md.
 *
 * Modal overlay that displays the buffered console output captured by the
 * console relay (MC5.1). Each entry shows a timestamp, a color-coded level
 * badge, and the serialized message in a monospace font.
 *
 * Composition mirrors DevMenu (MC5.9):
 *   - Full-screen `Modal` with a semi-transparent backdrop.
 *   - Dark bottom-sheet with rounded top corners.
 *   - Header row with "Recent Logs" title and an "X" close button.
 *   - Scrollable `FlatList` of entries (pulled on mount/visible).
 *   - Footer "Clear" button wipes the ring buffer and closes the modal.
 */
import React, { useEffect, useState } from 'react';
import {
    FlatList,
    Modal,
    Pressable,
    SafeAreaView,
    StyleSheet,
    Text,
    View,
} from 'react-native';
import { consoleRelay, type ConsoleEntry, type ConsoleLevel } from '../debug';

interface RecentLogsModalProps {
    /** Controls whether the modal is visible. */
    visible: boolean;
    /** Callback to dismiss the modal (backdrop tap, close button, or Clear). */
    onClose: () => void;
}

/* ── Colors (mirrors DevMenu dark theme) ── */
const SHEET_BG = '#1A1A1A';
const BACKDROP_BG = '#0A0A0A80';
const TEXT_PRIMARY = '#FFFFFF';
const TEXT_SECONDARY = '#A0A0A0';
const TIMESTAMP_COLOR = '#666666';
const SEPARATOR_COLOR = '#2A2A2A';
const ROW_BG = '#111111';
const CLEAR_BUTTON_BG = '#EF4444';

/** Per-level color used for the level badge text. */
const LEVEL_COLORS: Record<ConsoleLevel, string> = {
    log: '#FFFFFF',
    info: '#3B82F6',
    warn: '#FACC15',
    error: '#EF4444',
    debug: '#9CA3AF',
};

/** Format an ISO timestamp as `HH:MM:SS.mmm` for compact display. */
function formatTimestamp(iso: string): string {
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) {
        return iso;
    }
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    const seconds = String(date.getSeconds()).padStart(2, '0');
    const ms = String(date.getMilliseconds()).padStart(3, '0');
    return `${hours}:${minutes}:${seconds}.${ms}`;
}

export default function RecentLogsModal({ visible, onClose }: RecentLogsModalProps) {
    const [entries, setEntries] = useState<ConsoleEntry[]>([]);

    // Refresh the buffered entries whenever the modal becomes visible so the
    // user always sees the latest snapshot.
    useEffect(() => {
        if (visible) {
            setEntries(consoleRelay.getBuffer());
        }
    }, [visible]);

    const handleClear = (): void => {
        consoleRelay.clearBuffer();
        setEntries([]);
        onClose();
    };

    return (
        <Modal
            visible={visible}
            transparent
            animationType="slide"
            onRequestClose={onClose}
            statusBarTranslucent
        >
            {/* ── Backdrop ── */}
            <Pressable style={styles.backdrop} onPress={onClose}>
                <View style={styles.backdropFill} />
            </Pressable>

            {/* ── Bottom sheet ── */}
            <View style={styles.sheet}>
                <SafeAreaView style={styles.safeArea}>
                    {/* ── Header ── */}
                    <View style={styles.header}>
                        <Text style={styles.title}>Recent Logs</Text>
                        <Pressable
                            onPress={onClose}
                            style={({ pressed }) => [
                                styles.closeButton,
                                pressed && styles.pressed,
                            ]}
                            accessibilityRole="button"
                            accessibilityLabel="Close recent logs"
                        >
                            <Text style={styles.closeButtonText}>✕</Text>
                        </Pressable>
                    </View>

                    <View style={styles.separator} />

                    {/* ── Entry list ── */}
                    {entries.length === 0 ? (
                        <View style={styles.emptyContainer}>
                            <Text style={styles.emptyText}>No log entries</Text>
                        </View>
                    ) : (
                        <FlatList
                            data={entries}
                            keyExtractor={(_item, index) => String(index)}
                            style={styles.list}
                            contentContainerStyle={styles.listContent}
                            renderItem={({ item }) => (
                                <View style={styles.row}>
                                    <View style={styles.rowHeader}>
                                        <Text style={styles.timestamp}>
                                            {formatTimestamp(item.timestamp)}
                                        </Text>
                                        <Text
                                            style={[
                                                styles.level,
                                                { color: LEVEL_COLORS[item.level] },
                                            ]}
                                        >
                                            {item.level.toUpperCase()}
                                        </Text>
                                    </View>
                                    <Text style={styles.message}>{item.message}</Text>
                                </View>
                            )}
                            ItemSeparatorComponent={() => (
                                <View style={styles.itemSeparator} />
                            )}
                        />
                    )}

                    {/* ── Footer ── */}
                    <View style={styles.footer}>
                        <Pressable
                            onPress={handleClear}
                            style={({ pressed }) => [
                                styles.clearButton,
                                pressed && styles.pressed,
                            ]}
                            accessibilityRole="button"
                            accessibilityLabel="Clear log buffer"
                        >
                            <Text style={styles.clearButtonText}>Clear</Text>
                        </Pressable>
                    </View>
                </SafeAreaView>
            </View>
        </Modal>
    );
}

const styles = StyleSheet.create({
    backdrop: {
        flex: 1,
        backgroundColor: BACKDROP_BG,
        justifyContent: 'flex-end',
    },
    backdropFill: {
        flex: 1,
    },
    sheet: {
        backgroundColor: SHEET_BG,
        borderTopLeftRadius: 16,
        borderTopRightRadius: 16,
        maxHeight: '80%',
        overflow: 'hidden',
    },
    safeArea: {
        flexShrink: 1,
    },
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingHorizontal: 20,
        paddingTop: 16,
        paddingBottom: 12,
    },
    title: {
        fontSize: 18,
        fontWeight: '700',
        color: TEXT_PRIMARY,
    },
    closeButton: {
        width: 32,
        height: 32,
        borderRadius: 16,
        backgroundColor: '#2A2A2A',
        alignItems: 'center',
        justifyContent: 'center',
    },
    closeButtonText: {
        fontSize: 14,
        fontWeight: '600',
        color: TEXT_SECONDARY,
    },
    separator: {
        height: 1,
        backgroundColor: SEPARATOR_COLOR,
        marginHorizontal: 20,
    },
    list: {
        flexGrow: 0,
    },
    listContent: {
        paddingVertical: 8,
    },
    row: {
        paddingVertical: 10,
        paddingHorizontal: 20,
        backgroundColor: ROW_BG,
    },
    rowHeader: {
        flexDirection: 'row',
        alignItems: 'center',
        marginBottom: 4,
    },
    timestamp: {
        fontSize: 12,
        color: TIMESTAMP_COLOR,
        fontFamily: 'Courier',
        marginRight: 8,
    },
    level: {
        fontSize: 12,
        fontWeight: '700',
        fontFamily: 'Courier',
    },
    message: {
        fontSize: 13,
        color: TEXT_PRIMARY,
        fontFamily: 'Courier',
    },
    itemSeparator: {
        height: 1,
        backgroundColor: SEPARATOR_COLOR,
    },
    emptyContainer: {
        paddingVertical: 40,
        alignItems: 'center',
    },
    emptyText: {
        fontSize: 14,
        color: TEXT_SECONDARY,
    },
    footer: {
        paddingHorizontal: 20,
        paddingVertical: 12,
        borderTopWidth: 1,
        borderTopColor: SEPARATOR_COLOR,
    },
    clearButton: {
        backgroundColor: CLEAR_BUTTON_BG,
        paddingVertical: 12,
        borderRadius: 8,
        alignItems: 'center',
    },
    clearButtonText: {
        fontSize: 16,
        fontWeight: '600',
        color: TEXT_PRIMARY,
    },
    pressed: {
        opacity: 0.7,
    },
});

/**
 * DevMenu — MC5.9 of plans/onlook-mobile-client-task-queue.md.
 *
 * Modal overlay component that slides up from the bottom of the screen,
 * presenting a list of debug actions. Used by the dev menu trigger
 * (MC5.10) and populated with actions like reload bundle, clear storage,
 * toggle inspector, etc.
 *
 * Layout:
 *  - Semi-transparent dark backdrop covering the full screen
 *  - Bottom sheet with rounded top corners on a dark background
 *  - Header row: "Dev Menu" title on the left, close "X" button on the right
 *  - Scrollable list of full-width action buttons
 *  - Destructive actions render with red text
 */

import React from 'react';
import {
    Modal,
    Pressable,
    SafeAreaView,
    ScrollView,
    StyleSheet,
    Text,
    View,
} from 'react-native';

/** Describes a single action rendered inside the dev menu. */
export interface DevMenuAction {
    /** Human-readable label for the action button. */
    label: string;
    /** Callback invoked when the action is pressed. */
    onPress: () => void;
    /** When true, the label renders in red to signal a destructive operation. */
    destructive?: boolean;
}

interface DevMenuProps {
    /** Controls whether the modal is visible. */
    visible: boolean;
    /** Callback to dismiss the modal (backdrop tap or close button). */
    onClose: () => void;
    /** List of debug actions to render in the menu. */
    actions: DevMenuAction[];
}

const SHEET_BG = '#1A1A1A';
const BACKDROP_BG = '#0A0A0A80';
const DESTRUCTIVE_RED = '#EF4444';
const TEXT_PRIMARY = '#FFFFFF';
const TEXT_SECONDARY = '#A0A0A0';
const SEPARATOR_COLOR = '#2A2A2A';

export default function DevMenu({ visible, onClose, actions }: DevMenuProps) {
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
                {/* Empty pressable covers the area above the sheet */}
                <View style={styles.backdropFill} />
            </Pressable>

            {/* ── Bottom sheet ── */}
            <View style={styles.sheet}>
                <SafeAreaView>
                    {/* ── Header ── */}
                    <View style={styles.header}>
                        <Text style={styles.title}>Dev Menu</Text>
                        <Pressable
                            onPress={onClose}
                            style={({ pressed }) => [
                                styles.closeButton,
                                pressed && styles.pressed,
                            ]}
                            accessibilityRole="button"
                            accessibilityLabel="Close dev menu"
                        >
                            <Text style={styles.closeButtonText}>✕</Text>
                        </Pressable>
                    </View>

                    {/* ── Separator ── */}
                    <View style={styles.separator} />

                    {/* ── Action list ── */}
                    <ScrollView
                        style={styles.actionList}
                        contentContainerStyle={styles.actionListContent}
                        bounces={false}
                    >
                        {actions.map((action, index) => (
                            <React.Fragment key={action.label}>
                                <Pressable
                                    onPress={() => {
                                        action.onPress();
                                        onClose();
                                    }}
                                    style={({ pressed }) => [
                                        styles.actionButton,
                                        pressed && styles.pressed,
                                    ]}
                                    accessibilityRole="button"
                                    accessibilityLabel={action.label}
                                >
                                    <Text
                                        style={[
                                            styles.actionLabel,
                                            action.destructive === true &&
                                                styles.actionLabelDestructive,
                                        ]}
                                    >
                                        {action.label}
                                    </Text>
                                </Pressable>
                                {index < actions.length - 1 && (
                                    <View style={styles.actionSeparator} />
                                )}
                            </React.Fragment>
                        ))}

                        {actions.length === 0 && (
                            <View style={styles.emptyContainer}>
                                <Text style={styles.emptyText}>
                                    No actions available
                                </Text>
                            </View>
                        )}
                    </ScrollView>
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
        maxHeight: '60%',
        overflow: 'hidden',
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
    actionList: {
        flexGrow: 0,
    },
    actionListContent: {
        paddingVertical: 8,
    },
    actionButton: {
        paddingVertical: 16,
        paddingHorizontal: 20,
    },
    actionLabel: {
        fontSize: 16,
        fontWeight: '500',
        color: TEXT_PRIMARY,
    },
    actionLabelDestructive: {
        color: DESTRUCTIVE_RED,
    },
    actionSeparator: {
        height: 1,
        backgroundColor: SEPARATOR_COLOR,
        marginHorizontal: 20,
    },
    emptyContainer: {
        paddingVertical: 24,
        alignItems: 'center',
    },
    emptyText: {
        fontSize: 14,
        color: TEXT_SECONDARY,
    },
    pressed: {
        opacity: 0.7,
    },
});

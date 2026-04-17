/**
 * RecentSessionsList — MC3.9 of plans/onlook-mobile-client-task-queue.md.
 *
 * Renders a FlatList of recent relay sessions sourced from the MC3.8 secure
 * store. Each item displays the project name (or "Untitled"), relay host,
 * and a relative-time string for the last connection timestamp.
 *
 * Empty state: centered "No recent sessions" text.
 * Dark theme consistent with LauncherScreen.
 */

import React, { useEffect, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { getRecentSessions } from '../storage';
import type { RecentSession } from '../storage/recentSessions';

interface RecentSessionsListProps {
    onSelect: (session: RecentSession) => void;
}

/**
 * Format an ISO datetime string as a human-readable relative time.
 * Keeps it simple without external date libraries.
 */
function formatRelativeTime(isoDate: string): string {
    const now = Date.now();
    const then = new Date(isoDate).getTime();

    if (Number.isNaN(then)) {
        return isoDate;
    }

    const diffMs = now - then;
    if (diffMs < 0) {
        return 'just now';
    }

    const seconds = Math.floor(diffMs / 1000);
    if (seconds < 60) {
        return 'just now';
    }

    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) {
        return `${minutes} min ago`;
    }

    const hours = Math.floor(minutes / 60);
    if (hours < 24) {
        return `${hours}h ago`;
    }

    const days = Math.floor(hours / 24);
    if (days < 30) {
        return `${days}d ago`;
    }

    // Fall back to the ISO date string for older entries.
    return isoDate.split('T')[0] ?? isoDate;
}

export default function RecentSessionsList({ onSelect }: RecentSessionsListProps) {
    const [sessions, setSessions] = useState<RecentSession[]>([]);
    const [loaded, setLoaded] = useState(false);

    useEffect(() => {
        let cancelled = false;

        getRecentSessions().then((data) => {
            if (!cancelled) {
                setSessions(data);
                setLoaded(true);
            }
        });

        return () => {
            cancelled = true;
        };
    }, []);

    if (!loaded) {
        return (
            <View style={styles.centered}>
                <Text style={styles.emptyText}>Loading...</Text>
            </View>
        );
    }

    if (sessions.length === 0) {
        return (
            <View style={styles.centered}>
                <Text style={styles.emptyText}>No recent sessions</Text>
            </View>
        );
    }

    return (
        <FlatList
            data={sessions}
            keyExtractor={(item) => item.sessionId}
            style={styles.list}
            contentContainerStyle={styles.listContent}
            renderItem={({ item }) => (
                <Pressable
                    style={({ pressed }) => [
                        styles.row,
                        pressed && styles.rowPressed,
                    ]}
                    onPress={() => onSelect(item)}
                    accessibilityRole="button"
                    accessibilityLabel={`Session ${item.projectName ?? 'Untitled'}`}
                >
                    <View style={styles.rowTextContainer}>
                        <Text style={styles.projectName} numberOfLines={1}>
                            {item.projectName ?? 'Untitled'}
                        </Text>
                        <Text style={styles.relayHost} numberOfLines={1}>
                            {item.relayHost}
                        </Text>
                    </View>
                    <Text style={styles.timestamp}>
                        {formatRelativeTime(item.lastConnected)}
                    </Text>
                </Pressable>
            )}
        />
    );
}

const styles = StyleSheet.create({
    centered: {
        flex: 1,
        backgroundColor: '#0A0A0A',
        justifyContent: 'center',
        alignItems: 'center',
    },
    emptyText: {
        fontSize: 16,
        color: '#A0A0A0',
    },
    list: {
        flex: 1,
        backgroundColor: '#0A0A0A',
    },
    listContent: {
        paddingVertical: 8,
    },
    row: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingVertical: 14,
        paddingHorizontal: 24,
        borderBottomWidth: StyleSheet.hairlineWidth,
        borderBottomColor: '#333333',
    },
    rowPressed: {
        backgroundColor: '#1A1A1A',
    },
    rowTextContainer: {
        flex: 1,
        marginRight: 12,
    },
    projectName: {
        fontSize: 16,
        fontWeight: '600',
        color: '#FFFFFF',
        marginBottom: 2,
    },
    relayHost: {
        fontSize: 13,
        color: '#A0A0A0',
    },
    timestamp: {
        fontSize: 13,
        color: '#666666',
    },
});

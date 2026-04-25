import type { PropsWithChildren } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { colors, radius, spacing } from '../theme';

interface MetricCardProps extends PropsWithChildren {
  label: string;
  value: string;
}

export function MetricCard({ children, label, value }: MetricCardProps) {
  return (
    <View style={styles.card}>
      <Text style={styles.label}>{label}</Text>
      <Text style={styles.value}>{value}</Text>
      <Text style={styles.body}>{children}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    gap: spacing.xs,
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    padding: spacing.md,
  },
  label: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase',
  },
  value: {
    color: colors.text,
    fontSize: 24,
    fontWeight: '700',
  },
  body: {
    color: colors.secondaryText,
    fontSize: 14,
    lineHeight: 20,
  },
});

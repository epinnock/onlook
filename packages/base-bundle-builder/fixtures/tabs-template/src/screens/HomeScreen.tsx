import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { MetricCard } from '../components/MetricCard';
import { HOME_METRICS } from '../data/tabs';
import { FIXTURE_MARKER, colors, spacing } from '../theme';

export function HomeScreen() {
  return (
    <ScrollView contentContainerStyle={styles.container}>
      <View style={styles.hero}>
        <Text style={styles.kicker}>{FIXTURE_MARKER}</Text>
        <Text style={styles.title}>Tabs template fixture</Text>
        <Text style={styles.summary}>
          A compact React Native app with local tabs, shared data, and local components.
        </Text>
      </View>
      {HOME_METRICS.map((metric) => (
        <MetricCard key={metric.id} label={metric.label} value={metric.value}>
          {metric.body}
        </MetricCard>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: spacing.md,
    backgroundColor: colors.canvas,
    padding: spacing.lg,
    paddingTop: spacing.xl,
  },
  hero: {
    gap: spacing.sm,
    paddingBottom: spacing.sm,
  },
  kicker: {
    color: colors.accent,
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase',
  },
  title: {
    color: colors.text,
    fontSize: 34,
    fontWeight: '800',
  },
  summary: {
    color: colors.secondaryText,
    fontSize: 16,
    lineHeight: 23,
  },
});

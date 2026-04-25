import { FlatList, StyleSheet, Text, View } from 'react-native';

import { MetricCard } from '../components/MetricCard';
import { EXPLORE_ITEMS } from '../data/tabs';
import { colors, spacing } from '../theme';

export function ExploreScreen() {
  return (
    <View style={styles.container}>
      <Text style={styles.kicker}>Explore</Text>
      <Text style={styles.title}>Bundle surface area</Text>
      <FlatList
        data={EXPLORE_ITEMS}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.list}
        renderItem={({ item }) => (
          <MetricCard label={item.label} value={item.value}>
            {item.body}
          </MetricCard>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.canvas,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.xl,
  },
  kicker: {
    color: colors.accent,
    fontSize: 13,
    fontWeight: '700',
    textTransform: 'uppercase',
  },
  title: {
    color: colors.text,
    fontSize: 30,
    fontWeight: '700',
    marginTop: spacing.xs,
  },
  list: {
    gap: spacing.md,
    paddingTop: spacing.lg,
    paddingBottom: spacing.xl,
  },
});

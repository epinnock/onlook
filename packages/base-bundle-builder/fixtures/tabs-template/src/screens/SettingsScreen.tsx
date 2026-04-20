import { useState } from 'react';
import { StyleSheet, Switch, Text, View } from 'react-native';

import { colors, radius, spacing } from '../theme';

export function SettingsScreen() {
  const [useNativePreview, setUseNativePreview] = useState(true);

  return (
    <View style={styles.container}>
      <Text style={styles.kicker}>Settings</Text>
      <Text style={styles.title}>Fixture controls</Text>
      <View style={styles.row}>
        <View style={styles.copy}>
          <Text style={styles.label}>Native preview path</Text>
          <Text style={styles.description}>
            Stateful control used by smoke tests to verify events survive tab switches.
          </Text>
        </View>
        <Switch
          value={useNativePreview}
          onValueChange={setUseNativePreview}
          trackColor={{ false: colors.border, true: colors.accent }}
          thumbColor={colors.text}
        />
      </View>
      <Text style={styles.state}>
        {useNativePreview ? 'Native preview enabled' : 'Native preview paused'}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.canvas,
    padding: spacing.lg,
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
  row: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radius.card,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing.md,
    justifyContent: 'space-between',
    marginTop: spacing.lg,
    padding: spacing.md,
  },
  copy: {
    flex: 1,
    gap: spacing.xs,
  },
  label: {
    color: colors.text,
    fontSize: 16,
    fontWeight: '700',
  },
  description: {
    color: colors.secondaryText,
    fontSize: 14,
    lineHeight: 20,
  },
  state: {
    color: colors.muted,
    fontSize: 14,
    marginTop: spacing.md,
  },
});

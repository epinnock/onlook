import { useState, type ComponentType } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ExploreScreen } from '../screens/ExploreScreen';
import { HomeScreen } from '../screens/HomeScreen';
import { SettingsScreen } from '../screens/SettingsScreen';
import { colors, spacing } from '../theme';

type TabKey = 'home' | 'explore' | 'settings';

interface TabItem {
  key: TabKey;
  label: string;
  marker: string;
}

const TABS: TabItem[] = [
  {
    key: 'home',
    label: 'Home',
    marker: 'H',
  },
  {
    key: 'explore',
    label: 'Explore',
    marker: 'E',
  },
  {
    key: 'settings',
    label: 'Settings',
    marker: 'S',
  },
];

const TAB_SCREENS: Record<TabKey, ComponentType> = {
  home: HomeScreen,
  explore: ExploreScreen,
  settings: SettingsScreen,
};

export function Tabs() {
  const [activeTab, setActiveTab] = useState<TabKey>('home');
  const insets = useSafeAreaInsets();
  const ActiveScreen = TAB_SCREENS[activeTab];

  return (
    <View style={styles.shell}>
      <View style={styles.screen}>
        <ActiveScreen />
      </View>
      <View style={[styles.tabBar, { paddingBottom: Math.max(insets.bottom, spacing.sm) }]}>
        {TABS.map((tab) => {
          const isActive = tab.key === activeTab;

          return (
            <Pressable
              key={tab.key}
              accessibilityRole="button"
              accessibilityState={{ selected: isActive }}
              onPress={() => setActiveTab(tab.key)}
              style={({ pressed }) => [
                styles.tab,
                isActive && styles.activeTab,
                pressed && styles.pressedTab,
              ]}
              testID={`tabs-template-tab-${tab.key}`}
            >
              <Text style={[styles.marker, isActive && styles.activeText]}>{tab.marker}</Text>
              <Text style={[styles.label, isActive && styles.activeText]}>{tab.label}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  shell: {
    flex: 1,
    backgroundColor: colors.canvas,
  },
  screen: {
    flex: 1,
  },
  tabBar: {
    flexDirection: 'row',
    gap: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.navigation,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
  },
  tab: {
    alignItems: 'center',
    borderRadius: 8,
    flex: 1,
    gap: 2,
    minHeight: 52,
    justifyContent: 'center',
  },
  activeTab: {
    backgroundColor: colors.surface,
  },
  pressedTab: {
    opacity: 0.75,
  },
  marker: {
    color: colors.muted,
    fontSize: 13,
    fontWeight: '800',
  },
  label: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: '700',
  },
  activeText: {
    color: colors.accent,
  },
});

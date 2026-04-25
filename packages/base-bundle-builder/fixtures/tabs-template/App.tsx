import { StatusBar } from 'expo-status-bar';
import { StyleSheet } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { Tabs } from './src/navigation/Tabs';
import { colors } from './src/theme';

export default function App() {
  return (
    <SafeAreaProvider style={styles.root}>
      <StatusBar style="light" />
      <Tabs />
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.canvas,
  },
});
